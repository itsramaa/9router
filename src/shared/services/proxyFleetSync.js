// Proxy fleet aggregator: syncs fleet-owned proxies into local proxy pools with
// one batch request (instead of one HTTP health check per proxy), and reports
// exhausted proxies back to the fleet in a single batch. Fire-and-forget.
//
// Flow:
//   1. GET /api/v1/proxy/batch?pool_id=...&limit=...  →  fleet assigns proxies
//      (proxy_url + assignment_id), 1 HTTP request, no per-proxy probing.
//   2. Assigned proxies are upserted into local proxy pools (name "fleet:...").
//   3. Locally-exhausted fleet proxies are reported in one POST
//      /api/v1/proxy/report-exhausted/batch, then the next tick re-requests a
//      fresh batch.
//
// Fail-open: fleet unreachable/logged out never throws out of the tick; local
// pools keep working exactly as before.

import { fetch as undiciFetch } from "undici";

import { getProxyPoolById, getProxyPools, updateProxyPool, createProxyPool, getSettings } from "@/lib/localDb";
import { PROXY_FLEET_CONFIG } from "@/shared/constants/config";

const C = PROXY_FLEET_CONFIG;

// Survive Next.js hot reload; one scheduler per server process.
const g = (global.__proxyFleetSync ??= {
  interval: null,
  running: false,
  lastSyncAt: null,
  lastError: null,
  // Runtime overrides from settings (UI), merged over env defaults.
  settings: null,
  // proxy_url → assignment_id, kept so exhausted reports carry assignment ids.
  assignmentByUrl: new Map(),
  // proxy_url → { failedAt } for local cooldown before reporting to fleet.
  exhaustedPending: new Map(),
});

/** Normalize comma-separated list from settings/env into a non-empty array. */
function toList(value, fallback) {
  const arr = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : fallback;
}

function cfg() {
  const s = g.settings || {};
  const sCfg = s.proxyFleet || {};
  const enabled = sCfg.enabled !== undefined ? sCfg.enabled === true : C.enabled;
  const baseUrl =
    typeof sCfg.baseUrl === "string" && sCfg.baseUrl !== ""
      ? sCfg.baseUrl.replace(/\/+$/, "")
      : C.baseUrl;
  const apiKey = typeof sCfg.apiKey === "string" ? sCfg.apiKey : C.apiKey;
  const pools = toList(sCfg.pools, C.pools);
  const providers = toList(sCfg.providers, C.providers);
  return {
    enabled,
    baseUrl,
    apiKey,
    pools,
    batchLimit: Math.max(1, Math.min(Number(sCfg.batchLimit || C.batchLimit) || 500, 10000)),
    tickIntervalMs: Math.max(30000, Number(sCfg.tickIntervalMs || C.tickIntervalMs) || 45000),
    requestTimeoutMs: Math.min(Number(sCfg.requestTimeoutMs || C.requestTimeoutMs) || 5000, 30000),
    reportBatchSize: Math.max(1, Math.min(Number(sCfg.reportBatchSize || C.reportBatchSize) || 100, 1000)),
    localPoolPrefix: C.localPoolPrefix || "fleet:",
    providers,
  };
}

/** Reload runtime config from persisted settings. Safe to call on every tick. */
export async function refreshFleetConfig() {
  try {
    g.settings = await getSettings();
  } catch (e) {
    console.warn(`[FleetSync] settings read failed: ${e?.message || e}`);
  }
}

export function isFleetEnabled() {
  const { enabled, baseUrl, apiKey } = cfg();
  return enabled === true && Boolean(baseUrl) && Boolean(apiKey);
}

function fleetUrl(path) {
  return `${cfg().baseUrl}${path}`;
}

function fleetHeaders() {
  return {
    "Content-Type": "application/json",
    "X-API-Key": cfg().apiKey,
    "User-Agent": "9Router/proxy-fleet-sync",
  };
}

async function requestFleet(path, options = {}) {
  const timeoutMs = options.timeoutMs || cfg().requestTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(fleetUrl(path), {
      ...options,
      headers: { ...fleetHeaders(), ...(options.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || `fleet HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => null);
    return { ok: true, status: res.status, data };
  } catch (err) {
    const message =
      err?.name === "AbortError" ? `fleet request timed out (${timeoutMs}ms)` : (err?.message || String(err));
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function isFleetPool(pool) {
  return Boolean(pool?.name?.startsWith?.(cfg().localPoolPrefix));
}

function poolKey(pool) {
  return (pool?.proxyUrl || "").trim();
}

/**
 * Fetch a batch of active proxies from one fleet pool and upsert them into
 * local proxy pools. Returns { added, updated, assignments } for logging.
 */
export async function syncFleetPool(poolId) {
  const c = cfg();
  const qs = new URLSearchParams({ pool_id: poolId, limit: String(c.batchLimit), strategy: "lru" });
  const res = await requestFleet(`/api/v1/proxy/batch?${qs}`);

  if (!res.ok) {
    g.lastError = res.error;
    return { ok: false, error: res.error, added: 0, updated: 0, assignments: 0 };
  }

  const proxies = Array.isArray(res.data?.proxies) ? res.data.proxies : [];
  const assignments = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
  const assignmentByUrl = new Map();
  for (const a of assignments) {
    if (a?.proxy_url) assignmentByUrl.set(a.proxy_url, a.id || "");
  }

  const existing = await getProxyPools();
  const byUrl = new Map();
  for (const p of existing) byUrl.set(poolKey(p), p);

  let added = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const rawUrl of proxies) {
    const proxyUrl = String(rawUrl || "").trim();
    if (!proxyUrl) continue;

    const assignmentId = assignmentByUrl.get(proxyUrl) || "";
    if (assignmentId) assignmentByUrl.set(proxyUrl, assignmentId);

    const existingPool = byUrl.get(proxyUrl);
    if (existingPool) {
      if (existingPool.testStatus !== "active" || existingPool.isActive !== true) {
        await updateProxyPool(existingPool.id, {
          testStatus: "active",
          isActive: true,
          lastTestedAt: now,
          lastError: null,
          updatedAt: now,
        });
        updated += 1;
      }
    } else {
      const hostLabel = safeHostLabel(proxyUrl);
      await createProxyPool({
        name: `${c.localPoolPrefix}${hostLabel}`,
        proxyUrl,
        noProxy: "",
        type: "http",
        isActive: true,
        strictProxy: false,
        testStatus: "active",
        lastTestedAt: now,
        lastError: null,
      });
      added += 1;
    }
  }

  for (const [url, assignmentId] of assignmentByUrl) {
    g.assignmentByUrl.set(url, assignmentId);
  }
  g.lastError = null;
  return { ok: true, error: null, added, updated, assignments: proxies.length };
}

/** Sync every configured fleet pool; per-pool requests stay isolated. */
export async function syncFleetProxies() {
  const c = cfg();
  const totals = { ok: 0, failed: 0, added: 0, updated: 0, assignments: 0 };
  for (const poolId of c.pools) {
    try {
      const r = await syncFleetPool(poolId);
      totals.added += r.added;
      totals.updated += r.updated;
      totals.assignments += r.assignments;
      if (r.ok) totals.ok += 1;
      else {
        totals.failed += 1;
        console.warn(`[FleetSync] pool=${poolId} batch failed: ${r.error}`);
      }
    } catch (e) {
      totals.failed += 1;
      g.lastError = e?.message || String(e);
      console.warn(`[FleetSync] pool=${poolId} tick error: ${e.message}`);
    }
  }
  return { ok: totals.failed === 0, ...totals };
}

function safeHostLabel(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    return u.hostname && u.port ? `${u.hostname}:${u.port}` : (u.hostname || proxyUrl);
  } catch {
    return proxyUrl;
  }
}

/**
 * Mark a fleet proxy as locally exhausted. It is queued in memory and reported
 * to the fleet on the next tick (or when the queue is full enough).
 * Fail-open: unknown/non-fleet URLs are ignored.
 */
export function markFleetProxyExhausted(proxyUrl, { reason = "upstream_rate_limited", assignmentId = "" } = {}) {
  const url = String(proxyUrl || "").trim();
  if (!url || !isFleetEnabled()) return;

  const pending = g.exhaustedPending.get(url);
  if (pending) return; // already queued
  g.exhaustedPending.set(url, {
    assignmentId: assignmentId || g.assignmentByUrl.get(url) || "",
    reason: reason || "upstream_rate_limited",
    failedAt: Date.now(),
  });
}

/**
 * Report queued exhausted proxies to the fleet in one batch request, then
 * deactivate the corresponding local pools. Fire-and-forget.
 */
export async function flushExhaustedReports() {
  if (g.exhaustedPending.size === 0) return { ok: true, reported: 0 };

  const items = [];
  for (const [url, pending] of g.exhaustedPending) {
    items.push({
      assignment_id: pending.assignmentId || "",
      proxy_url: url,
      reason: pending.reason || "upstream_rate_limited",
    });
  }

  const res = await requestFleet("/api/v1/proxy/report-exhausted/batch", {
    method: "POST",
    body: JSON.stringify({ reports: items }),
  });

  if (!res.ok) {
    g.lastError = res.error;
    return { ok: false, error: res.error, reported: 0 };
  }

  const now = new Date().toISOString();
  for (const url of g.exhaustedPending.keys()) {
    const pool = await getProxyPoolByUrl(url);
    if (pool) {
      await updateProxyPool(pool.id, {
        testStatus: "error",
        isActive: false,
        lastTestedAt: now,
        lastError: "exhausted reported to fleet",
        updatedAt: now,
      });
    }
  }
  g.exhaustedPending.clear();
  g.lastError = null;
  return { ok: true, reported: items.length };
}

async function getProxyPoolByUrl(proxyUrl) {
  const pools = await getProxyPools();
  return pools.find((p) => poolKey(p) === String(proxyUrl || "").trim()) || null;
}

/**
 * Hook called by auth.js markAccountUnavailable: when an upstream rate limit /
 * quota-exhaustion failure happens on a provider that runs through fleet-owned
 * proxies, queue the used fleet proxy for the next batch report. Fail-open:
 * unknown provider / non-fleet pool / fleet disabled → no-op, never throws.
 */
export async function maybeReportFleetExhaustion({ provider, connection, status, errorText }) {
  try {
    if (!isFleetEnabled()) return;
    const c = cfg();
    const providerId = String(provider || "").toLowerCase();
    if (!c.providers.includes(providerId)) return;

    const poolId = connection?.providerSpecificData?.proxyPoolId;
    if (!poolId) return;
    const pool = await getProxyPoolById(poolId);
    if (!pool || !isFleetPool(pool)) return;

    const s = Number(status);
    const text = String(errorText || "");
    const isRateLimit = s === 429 || /rate limit|too many requests|overloaded|capacity/i.test(text);
    const isQuotaExhausted = /quota|billing|insufficient|payment/i.test(text);
    if (!isRateLimit && !isQuotaExhausted) return;

    const reason = isQuotaExhausted ? "upstream_quota_exhausted" : "upstream_rate_limited";
    markFleetProxyExhausted(pool.proxyUrl, { reason });
  } catch (e) {
    console.warn(`[FleetSync] exhaustion hook error: ${e?.message || e}`);
  }
}

async function runTick() {
  if (g.running) return;
  g.running = true;
  try {
    await refreshFleetConfig();
    if (!isFleetEnabled()) return;

    // Report exhausted first so the next batch request returns fresh proxies.
    await flushExhaustedReports();
    const sync = await syncFleetProxies();
    if (sync.ok) {
      console.log(
        `[FleetSync] pools=[${cfg().pools.join(",")}] assigned=${sync.assignments} added=${sync.added} updated=${sync.updated}`
      );
    } else {
      console.warn(`[FleetSync] batch failed (${sync.failed}/${cfg().pools.length} pools)`);
    }
  } catch (e) {
    g.lastError = e?.message || String(e);
    console.warn(`[FleetSync] tick error: ${e.message}`);
  } finally {
    g.running = false;
  }
}

/**
 * Restart scheduler with the latest settings (UI changes take effect
 * immediately). Call after updating settings.proxyFleet.
 */
export async function reconfigureProxyFleetSync() {
  await refreshFleetConfig();
  const enabled = isFleetEnabled();
  if (enabled) {
    if (!g.interval) {
      console.log(`[FleetSync] scheduler started (pools=[${cfg().pools.join(",")}], every ${Math.round(cfg().tickIntervalMs / 1000)}s)`);
      runTick().catch(() => {});
      g.interval = setInterval(() => {
        runTick().catch(() => {});
      }, cfg().tickIntervalMs);
      if (g.interval.unref) g.interval.unref();
    }
  } else if (g.interval) {
    clearInterval(g.interval);
    g.interval = null;
    console.log("[FleetSync] scheduler stopped");
  }
}

export function startProxyFleetSync() {
  reconfigureProxyFleetSync().catch(() => {});
}

export function stopProxyFleetSync() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[FleetSync] scheduler stopped");
}