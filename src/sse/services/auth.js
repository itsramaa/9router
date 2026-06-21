import {
  getProviderConnections,
  validateApiKey,
  updateProviderConnection,
  getSettings,
} from '@/lib/localDb';

import { resolveConnectionProxyConfig } from '@/lib/network/connectionProxy';

import {
  formatRetryAfter,
  isModelLockActive,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
} from 'open-sse/services/accountFallback.js';

import { resolveCooldown } from 'open-sse/services/cooldownPolicy.js';

import {
  deactivate as lifecycleDeactivate,
  pause as lifecyclePause,
  clearQuotaWarning,
} from '@/shared/services/accountLifecycle';

import {
  resolveProviderId,
  FREE_PROVIDERS,
} from '@/shared/constants/providers.js';

import * as log from '../utils/logger.js';

// Mutex to prevent race conditions during account selection

const _authState = (global.__authState ??= {
  selectionMutex: Promise.resolve(),
}); // BUG-014 fix

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

  options = {}
) {
  const excludeSet =
    excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : excludeConnectionIds
        ? new Set([excludeConnectionIds])
        : new Set();

  const preferredConnectionId = options?.preferredConnectionId || null;

  const currentMutex = _authState.selectionMutex;

  let resolveMutex;

  _authState.selectionMutex = new Promise((resolve) => {
    resolveMutex = resolve;
  });

  try {
    await currentMutex;

    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers

    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();

      const override = (settings.providerStrategies || {})[providerId] || {};

      const resolvedProxy = await resolveConnectionProxyConfig({
        proxyPoolId: override.proxyPoolId || '',
      });

      return {
        id: 'noauth',

        connectionName: 'Public',

        isActive: true,

        accessToken: 'public',

        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,

          connectionProxyUrl: resolvedProxy.connectionProxyUrl,

          connectionNoProxy: resolvedProxy.connectionNoProxy,

          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,

          vercelRelayUrl: resolvedProxy.vercelRelayUrl || '',
        },
      };
    }

    const connections = await getProviderConnections({
      provider: providerId,

      isActive: true,
    });

    log.debug(
      'AUTH',

      `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(',') : 'none'}, model: ${model || 'any'}`
    );

    if (connections.length === 0) {
      log.warn('AUTH', `No credentials for ${provider}`);

      return null;
    }

    const availableConnections = connections.filter((c) => {
      if (excludeSet.has(c.id)) return false;

      if (isModelLockActive(c, model)) return false;

      return true;
    });

    log.debug(
      'AUTH',

      `${provider} | available: ${availableConnections.length}/${connections.length}`
    );

    connections.forEach((c) => {
      const excluded = excludeSet.has(c.id);

      const locked = isModelLockActive(c, model);

      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);

        log.debug(
          'AUTH',

          `  → ${c.id?.slice(0, 8)} | ${excluded ? 'excluded' : ''} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ''}`
        );
      }
    });

    if (availableConnections.length === 0) {
      const lockedConns = connections.filter((c) =>
        isModelLockActive(c, model)
      );

      const expiries = lockedConns

        .map((c) => getEarliestModelLockUntil(c))

        .filter(Boolean);

      const earliest = expiries.sort()[0] || null;

      // Also check paused connections (isActive=false, pausedUntil in future)

      const pausedConns = await getProviderConnections({
        provider: providerId,

        isActive: false,
      });

      const now = Date.now();

      const activePaused = pausedConns.filter(
        (c) => c.pausedUntil && new Date(c.pausedUntil).getTime() > now
      );

      const earliestPaused =
        activePaused

          .map((c) => c.pausedUntil)

          .filter(Boolean)

          .sort()[0] || null;

      // Use the soonest of locked or paused expiry

      const earliestRetry =
        [earliest, earliestPaused].filter(Boolean).sort()[0] || null;

      if (earliestRetry) {
        const earliestConn = lockedConns[0] || activePaused[0];

        log.warn(
          'AUTH',

          `${provider} | all ${connections.length} accounts locked/paused for ${model || 'all'} (${formatRetryAfter(earliestRetry)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`
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
        'AUTH',

        `${provider} | all ${connections.length} accounts unavailable`
      );

      return null;
    }

    const settings = await getSettings();

    const providerOverride =
      (settings.providerStrategies || {})[providerId] || {};

    const strategy =
      providerOverride.fallbackStrategy ||
      settings.fallbackStrategy ||
      'fill-first';

    let connection;

    if (preferredConnectionId) {
      connection = availableConnections.find(
        (c) => c.id === preferredConnectionId
      );

      if (connection) {
        log.info(
          'AUTH',

          `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || 'unnamed'})`
        );
      }
    }

    if (connection) {
      // pinned — skip strategy
    } else if (strategy === 'round-robin') {
      const stickyLimit =
        providerOverride.stickyRoundRobinLimit ||
        settings.stickyRoundRobinLimit ||
        3;

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
        connection = current;

        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),

          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1,
        });
      } else {
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt)
            return (a.priority || 999) - (b.priority || 999);

          if (!a.lastUsedAt) return -1;

          if (!b.lastUsedAt) return 1;

          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),

          consecutiveUseCount: 1,
        });
      }
    } else {
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(
      connection.providerSpecificData || {}
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

        vercelRelayUrl: resolvedProxy.vercelRelayUrl || '',
      },

      connectionId: connection.id,

      testStatus: connection.testStatus,

      lastError: connection.lastError,

      _connection: connection,
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**







 * Mark account+model as unavailable.







 * Dispatches to the appropriate lifecycle action based on CooldownPolicy classification:







 *   action=deactivate → AccountLifecycle.deactivate() (ban detected, permanent)







 *   action=pause + cooldownMs≥1h → AccountLifecycle.pause() (quota exhausted, long duration)







 *   action=lock → modelLock_* per model (default, short-to-medium cooldown)







 * @param {string} connectionId







 * @param {number} status - HTTP status code from upstream







 * @param {string} errorText







 * @param {string|null} provider







 * @param {string|null} model - The specific model that triggered the error







 * @param {number|null} resetsAtMs - Optional precise provider-reported reset epoch ms







 * @returns {{ shouldFallback: boolean, cooldownMs: number }}







 */

export async function markAccountUnavailable(
  connectionId,

  status,

  errorText,

  provider = null,

  model = null,

  resetsAtMs = null
) {
  if (!connectionId || connectionId === 'noauth')
    return { shouldFallback: false, cooldownMs: 0 };

  const connections = await getProviderConnections({ provider });

  const conn = connections.find((c) => c.id === connectionId);

  const backoffLevel = conn?.backoffLevel || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel, action } =
    resolveCooldown(status, errorText, backoffLevel, resetsAtMs);

  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason =
    typeof errorText === 'string' ? errorText.slice(0, 100) : 'Provider error';

  const connName =
    conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);

  // Ban/suspended — permanent deactivation, no auto-recovery

  if (action === 'deactivate') {
    try {
      await lifecycleDeactivate(connectionId);

      log.warn(
        'AUTH',

        `${connName} DEACTIVATED (ban detected) [${status}]: ${reason}`
      );

      console.error(
        `🚫 ${provider || connectionId} [${status}] banned: ${reason}`
      );
    } catch (e) {
      log.warn('AUTH', `${connName} deactivate failed: ${e.message}`);
    }

    return { shouldFallback: true, cooldownMs: 0 };
  }

  // Escalated pause — quota exhausted with long cooldown (≥1h)

  if (action === 'pause' && cooldownMs >= 60 * 60 * 1000) {
    try {
      await lifecyclePause(connectionId, cooldownMs);

      log.warn(
        'AUTH',

        `${connName} PAUSED for ${Math.round(cooldownMs / 60000)}min [${status}]: ${reason}`
      );
    } catch (e) {
      // Fallback to modelLock if pause fails (e.g. connection not found race)

      log.warn(
        'AUTH',

        `${connName} pause failed, falling back to lock: ${e.message}`
      );

      const lockUpdate = buildModelLockUpdate(model, cooldownMs);

      await updateProviderConnection(connectionId, {
        ...lockUpdate,

        testStatus: 'unavailable',

        lastError: reason,

        errorCode: status,

        lastErrorAt: new Date().toISOString(),

        backoffLevel: newBackoffLevel ?? backoffLevel,
      });
    }

    return { shouldFallback: true, cooldownMs };
  }

  // Default: per-model lock (short-to-medium cooldown)

  const lockUpdate = buildModelLockUpdate(model, cooldownMs);

  // BUG-2 FIX: Only set testStatus='unavailable' for significant locks (>= 1 minute)

  // Short rate limits (< 60s) should not mark account as unavailable in UI

  const isSignificantLock = cooldownMs >= 60 * 1000;

  const updateObj = {
    ...lockUpdate,

    lastError: reason,

    errorCode: status,

    lastErrorAt: new Date().toISOString(),

    backoffLevel: newBackoffLevel ?? backoffLevel,
  };

  if (isSignificantLock) {
    updateObj.testStatus = 'unavailable';
  }

  await updateProviderConnection(connectionId, updateObj);

  const lockKey = Object.keys(lockUpdate)[0];

  log.warn(
    'AUTH',

    `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`
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

  model = null
) {
  if (!connectionId || connectionId === 'noauth') return;

  const conn = currentConnection._connection || currentConnection;

  const now = Date.now();

  const allLockKeys = Object.keys(conn).filter((k) =>
    k.startsWith('modelLock_')
  );

  if (
    !conn.testStatus &&
    !conn.lastError &&
    !conn.quotaStatus &&
    allLockKeys.length === 0
  )
    return;

  const keysToClear = allLockKeys.filter((k) => {
    if (model && k === `modelLock_${model}`) return true;

    if (model && k === 'modelLock___all') return true;

    const expiry = conn[k];

    return expiry && new Date(expiry).getTime() <= now;
  });

  if (
    keysToClear.length === 0 &&
    conn.testStatus !== 'unavailable' &&
    !conn.lastError
  )
    return;

  const remainingActiveLocks = allLockKeys.filter((k) => {
    if (keysToClear.includes(k)) return false;

    const expiry = conn[k];

    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map((k) => [k, null]));

  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: 'active',

      lastError: null,

      lastErrorAt: null,

      backoffLevel: 0,
    });
  }

  // Always clear quota warning flags on successful request
  // This ensures stale QuotaMonitor warnings are removed when chat succeeds
  if (conn.quotaStatus) {
    clearObj.quotaStatus = null;
    clearObj.quotaWarningAt = null;
    clearObj.quotaWarningMessage = null;
  }

  await updateProviderConnection(connectionId, clearObj);

  // Invalidate QuotaStore cache so next quota check fetches fresh data
  try {
    const QuotaStore = await import('open-sse/services/quotaStore.js');
    QuotaStore.invalidate(connectionId);
  } catch (e) {
    // QuotaStore may not be available in all contexts
  }
}

/**







 * Extract API key from request headers







 */

export function extractApiKey(request) {
  const authHeader = request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const xApiKey = request.headers.get('x-api-key');

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
