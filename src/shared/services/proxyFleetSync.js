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

import { 
  getProxyPoolById, 
  getProxyPools, 
  updateProxyPool, 
  createProxyPool, 
  getSettings,
  getFleetPoolByFleetId,
  createFleetPool,
  updateFleetPoolProxies,
  markProxyExhausted
} from "@/lib/db/index.js";
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

/**
 * Fetch a batch of active proxies from one fleet pool and upsert them into
 * a single local fleet pool with rotation. Returns { ok, added, updated } for logging.
 */
export async function syncFleetPool(poolId) {
  const c = cfg();
  const qs = new URLSearchParams({ pool_id: poolId, limit: String(c.batchLimit), strategy: "lru" });
  const res = await requestFleet(`/api/v1/proxy/batch?${qs}`);

  if (!res.ok) {
    g.lastError = res.error;
    return { ok: false, error: res.error, added: 0, updated: 0 };
  }

  const proxies = Array.isArray(res.data?.proxies) ? res.data.proxies : [];
  const assignments = Array.isArray(res.data?.assignments) ? res.data.assignments : [];
  
  // Store assignment IDs for exhaustion reporting
  const assignmentByUrl = new Map();
  for (const a of assignments) {
    if (a?.proxy_url) {
      assignmentByUrl.set(a.proxy_url, a.id || "");
      g.assignmentByUrl.set(a.proxy_url, a.id || "");
    }
  }

  const newProxies = proxies.map(url => String(url || "").trim()).filter(Boolean);
  if (newProxies.length === 0) {
    return { ok: true, error: null, added: 0, updated: 0 };
  }

  // Find existing fleet pool
  const existingPool = await getFleetPoolByFleetId(poolId);
  
  let added = 0;
  let updated = 0;

  if (!existingPool) {
    // Create new fleet pool
    await createFleetPool(poolId, newProxies);
    added = newProxies.length;
  } else {
    // Merge: existing active proxies + new proxies, deduplicate
    const existingActive = (existingPool.proxyUrls || []).filter(
      url => !(existingPool.exhaustedProxies || []).includes(url)
    );
    const merged = [...new Set([...existingActive, ...newProxies])];
    
    await updateFleetPoolProxies(existingPool.id, merged);
    added = merged.length - existingActive.length;
    updated = existingActive.length;
  }

  g.lastError = null;
  return { ok: true, error: null, added, updated };
}

/** Sync every configured fleet pool; per-pool requests stay isolated. */
export async function syncFleetProxies() {
  const c = cfg();
  const totals = { ok: 0, failed: 0, added: 0, updated: 0 };
  for (const poolId of c.pools) {
    try {
      const r = await syncFleetPool(poolId);
      totals.added += r.added;
      totals.updated += r.updated;
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

/**
 * Check if fleet pool has exhausted proxies and report them to fleet.
 * Returns { ok, shouldSync } - shouldSync=true means we need fresh proxies.
 */
async function checkAndReportExhausted(poolId) {
  try {
    const pool = await getFleetPoolByFleetId(poolId);
    if (!pool) {
      return { ok: true, shouldSync: true };
    }

    const proxyUrls = pool.proxyUrls || [];
    const exhaustedProxies = pool.exhaustedProxies || [];
    const activeCount = proxyUrls.length - exhaustedProxies.length;

    // If we have enough active proxies, no need to sync yet
    if (activeCount > 100) {
      return { ok: true, shouldSync: false };
    }

    // Report exhausted proxies if any
    if (exhaustedProxies.length > 0) {
      const reports = exhaustedProxies.map(url => ({
        assignment_id: g.assignmentByUrl.get(url) || "",
        proxy_url: url,
        reason: "upstream_rate_limited",
      }));

      const res = await requestFleet("/api/v1/proxy/report-exhausted/batch", {
        method: "POST",
        body: JSON.stringify({ reports }),
      });

      if (!res.ok) {
        g.lastError = res.error;
        return { ok: false, shouldSync: true, error: res.error };
      }

      // Clear exhausted proxies after successful report
      await updateFleetPoolProxies(pool.id, proxyUrls.filter(url => !exhaustedProxies.includes(url)));
      
      // Clear from assignment tracking
      for (const url of exhaustedProxies) {
        g.assignmentByUrl.delete(url);
      }
    }

    return { ok: true, shouldSync: true };
  } catch (e) {
    console.warn(`[FleetSync] checkAndReportExhausted pool=${poolId} error: ${e?.message || e}`);
    return { ok: false, shouldSync: true, error: e?.message || String(e) };
  }
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
 * Hook called by auth.js markAccountUnavailable: when an upstream rate limit /
 * quota-exhaustion failure happens on a provider that runs through fleet-owned
 * proxies, mark the current proxy as exhausted in the fleet pool. Fail-open:
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
    if (!pool || pool.type !== "fleet") return;

    const s = Number(status);
    const text = String(errorText || "");
    const isRateLimit = s === 429 || /rate limit|too many requests|overloaded|capacity/i.test(text);
    const isQuotaExhausted = /quota|billing|insufficient|payment/i.test(text);
    if (!isRateLimit && !isQuotaExhausted) return;

    // Get the current proxy being used from rotation
    const proxyUrls = pool.proxyUrls || [];
    const currentIndex = pool.currentIndex || 0;
    if (proxyUrls.length === 0) return;
    
    const currentProxy = proxyUrls[currentIndex % proxyUrls.length];
    if (!currentProxy) return;

    await markProxyExhausted(pool.id, currentProxy);
    console.log(`[FleetSync] marked exhausted: ${currentProxy} in pool ${pool.name}`);
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

    const c = cfg();
    let totalAdded = 0;
    let totalUpdated = 0;

    // Check and report exhausted proxies for each pool, then sync if needed
    for (const poolId of c.pools) {
      try {
        const exhaustCheck = await checkAndReportExhausted(poolId);
        
        if (exhaustCheck.shouldSync) {
          const syncResult = await syncFleetPool(poolId);
          totalAdded += syncResult.added;
          totalUpdated += syncResult.updated;
          
          if (!syncResult.ok) {
            console.warn(`[FleetSync] pool=${poolId} sync failed: ${syncResult.error}`);
          }
        }
      } catch (e) {
        console.warn(`[FleetSync] pool=${poolId} tick error: ${e?.message || e}`);
      }
    }

    if (totalAdded > 0 || totalUpdated > 0) {
      console.log(
        `[FleetSync] pools=[${c.pools.join(",")}] added=${totalAdded} updated=${totalUpdated}`
      );
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