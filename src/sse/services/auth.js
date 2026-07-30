import {
  getProviderConnections,
  getProviderConnectionById,
  validateApiKey,
  updateProviderConnection,
  getSettings,
  getProxyPools,
  atomicUpdateBackoffLevel,
} from "@/lib/localDb";
import {
  resolveConnectionProxyConfig,
  pickProxyPoolId,
} from "@/lib/network/connectionProxy";
import {
  formatRetryAfter,
  isModelLockActive,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
} from "open-sse/services/accountFallback.js";
import { hasAnyActiveLock } from "open-sse/services/modelLockStore.js";
import {
  resolveCooldown,
  LOCK_VS_PAUSE_THRESHOLD_MS,
} from "open-sse/services/cooldownPolicy.js";
import {
  deactivate as lifecycleDeactivate,
  pause as lifecyclePause,
  resumeExpiredPauses,
} from "@/shared/services/accountLifecycle.js";
import {
  resolveProviderId,
  FREE_PROVIDERS,
} from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(
  provider,
  excludeConnectionIds = null,
  model = null,
  options = {},
) {
  // Normalize to Set for consistent handling
  const excludeSet =
    excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : excludeConnectionIds
        ? new Set([excludeConnectionIds])
        : new Set();
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise((resolve) => {
    resolveMutex = resolve;
  });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Auto-resume expired pauses before selection (idempotent; outside mutex ideal, kept here for minimal seam)
    try {
      await resumeExpiredPauses(providerId);
    } catch (e) {
      log.warn("AUTH", `Failed to resume expired pauses for ${providerId}: ${e.message}`);
    }

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter((p) => p.proxyUrl).map((p) => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({
        proxyPoolId: pickedId || "",
      });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const connections = await getProviderConnections({
      provider: providerId,
      isActive: true,
    });
    log.debug(
      "AUTH",
      `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`,
    );

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out model-locked, ARN-stale, and excluded connections
    const availableConnections = connections.filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (c.provider === "kiro" && c.needsArnRefresh) return false;
      // model=null: isModelLockActive only checks __all; use hasAnyActiveLock
      if (model === null) {
        if (hasAnyActiveLock(c)) return false;
      } else if (isModelLockActive(c, model)) {
        return false;
      }
      return true;
    });

    log.debug(
      "AUTH",
      `${provider} | available: ${availableConnections.length}/${connections.length}`,
    );
    connections.forEach((c) => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug(
          "AUTH",
          `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`,
        );
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockedConns = connections.filter((c) =>
        model === null ? hasAnyActiveLock(c) : isModelLockActive(c, model),
      );
      const expiries = lockedConns
        .map((c) => getEarliestModelLockUntil(c))
        .filter(Boolean);
      const earliest = expiries.sort()[0] || null;

      const pausedConns = await getProviderConnections({
        provider: providerId,
        isActive: false,
      });
      const now = Date.now();
      const activePaused = pausedConns.filter(
        (c) => c.pausedUntil && new Date(c.pausedUntil).getTime() > now,
      );
      const earliestPaused =
        activePaused
          .map((c) => c.pausedUntil)
          .filter(Boolean)
          .sort()[0] || null;
      const earliestRetry =
        [earliest, earliestPaused].filter(Boolean).sort()[0] || null;

      if (earliestRetry) {
        const earliestConn = lockedConns[0] || activePaused[0];
        log.warn(
          "AUTH",
          `${provider} | all ${connections.length} accounts locked/paused for ${model || "all"} (${formatRetryAfter(earliestRetry)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`,
        );
        return {
          allRateLimited: true,
          retryAfter: earliestRetry,
          retryAfterHuman: formatRetryAfter(earliestRetry),
          pausedUntil: earliestPaused || null,
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null,
        };
      }
      log.warn(
        "AUTH",
        `${provider} | all ${connections.length} accounts unavailable`,
      );
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride =
      (settings.providerStrategies || {})[providerId] || {};
    const strategy =
      providerOverride.fallbackStrategy ||
      settings.fallbackStrategy ||
      "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find(
        (c) => c.id === preferredConnectionId,
      );
      if (connection) {
        log.info(
          "AUTH",
          `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`,
        );
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit =
        providerOverride.stickyRoundRobinLimit ||
        settings.stickyRoundRobinLimit ||
        3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt)
          return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1,
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt)
            return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1,
        });
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(
      connection.providerSpecificData || {},
    );

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName:
        connection.displayName ||
        connection.name ||
        connection.email ||
        connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection,
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable.
 * Dispatches via CooldownPolicy: deactivate (ban) | pause (quota/auth) | lock (per-model).
 */
export async function markAccountUnavailable(
  connectionId,
  status,
  errorText,
  provider = null,
  model = null,
  resetsAtMs = null,
) {
  if (!connectionId || connectionId === "noauth")
    return { shouldFallback: false, cooldownMs: 0 };

  const conn = await getProviderConnectionById(connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel, action, isAuthError } =
    resolveCooldown(status, errorText, backoffLevel, resetsAtMs);

  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason =
    typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const connName =
    conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);

  if (action === "deactivate") {
    try {
      await lifecycleDeactivate(connectionId, "ban");
      log.warn(
        "AUTH",
        `${connName} DEACTIVATED (ban detected) [${status}]: ${reason}`,
      );
      console.error(
        `🚫 ${provider || connectionId} [${status}] banned: ${reason}`,
      );
    } catch (e) {
      log.warn("AUTH", `${connName} deactivate failed: ${e.message}`);
    }
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // Auth errors with short cooldown get a pause floor (≥1h)
  if (
    action === "pause" &&
    cooldownMs < LOCK_VS_PAUSE_THRESHOLD_MS &&
    isAuthError
  ) {
    const floorCooldown = LOCK_VS_PAUSE_THRESHOLD_MS;
    try {
      await lifecyclePause(connectionId, floorCooldown);
      await updateProviderConnection(connectionId, {
        backoffLevel: newBackoffLevel ?? backoffLevel,
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date().toISOString(),
      });
      log.warn(
        "AUTH",
        `${connName} PAUSED (auth floor) for ${Math.round(floorCooldown / 60000)}min [${status}]: ${reason}`,
      );
    } catch (e) {
      log.warn(
        "AUTH",
        `${connName} auth floor pause failed, falling back to lock: ${e.message}`,
      );
      const lockUpdate = buildModelLockUpdate(model, floorCooldown);
      await updateProviderConnection(connectionId, {
        ...lockUpdate,
        testStatus: "unavailable",
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date().toISOString(),
        backoffLevel: newBackoffLevel ?? backoffLevel,
      });
    }
    return { shouldFallback: true, cooldownMs: floorCooldown };
  }

  if (action === "pause" && cooldownMs >= LOCK_VS_PAUSE_THRESHOLD_MS) {
    try {
      await lifecyclePause(connectionId, cooldownMs);
      await updateProviderConnection(connectionId, {
        backoffLevel: newBackoffLevel ?? backoffLevel,
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date().toISOString(),
      });
      log.warn(
        "AUTH",
        `${connName} PAUSED for ${Math.round(cooldownMs / 60000)}min [${status}]: ${reason}`,
      );
    } catch (e) {
      log.warn(
        "AUTH",
        `${connName} pause failed, falling back to lock: ${e.message}`,
      );
      const lockUpdate = buildModelLockUpdate(model, cooldownMs);
      await updateProviderConnection(connectionId, {
        ...lockUpdate,
        testStatus: "unavailable",
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date().toISOString(),
        backoffLevel: newBackoffLevel ?? backoffLevel,
      });
    }
    return { shouldFallback: true, cooldownMs };
  }

  // Default: per-model lock (atomic backoff to avoid concurrent double-increment)
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);
  const isSignificantLock = cooldownMs >= 60 * 1000;

  await atomicUpdateBackoffLevel(connectionId, (currentBackoff) => {
    const classified = resolveCooldown(
      status,
      errorText,
      currentBackoff,
      resetsAtMs,
    );
    return {
      newBackoffLevel: classified.newBackoffLevel ?? currentBackoff,
      extraFields: {
        ...lockUpdate,
        lastError: reason,
        errorCode: status,
        lastErrorAt: new Date().toISOString(),
        ...(isSignificantLock ? { testStatus: "unavailable" } : {}),
      },
    };
  });

  const lockKey = Object.keys(lockUpdate)[0];
  log.warn(
    "AUTH",
    `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`,
  );

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(
  connectionId,
  currentConnection,
  model = null,
) {
  if (!connectionId || connectionId === "noauth") return;
  // Fresh DB read — avoid stale credential-selection snapshot
  const conn =
    (await getProviderConnectionById(connectionId)) ||
    currentConnection?._connection ||
    currentConnection;
  if (!conn) return;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter((k) =>
    k.startsWith("modelLock_"),
  );

  if (
    !conn.testStatus &&
    !conn.lastError &&
    !conn.quotaStatus &&
    !conn.needsArnRefresh &&
    allLockKeys.length === 0
  )
    return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter((k) => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;
  });

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter((k) => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map((k) => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
  }

  if (conn.quotaStatus) {
    clearObj.quotaStatus = null;
    clearObj.quotaWarningAt = null;
    clearObj.quotaWarningMessage = null;
    clearObj.errorCode = null;
  }
  if (conn.needsArnRefresh) {
    clearObj.needsArnRefresh = null;
  }

  if (Object.keys(clearObj).length === 0) return;
  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
