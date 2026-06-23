/**
 * AccountLifecycle
 * Centralized activate/deactivate/pause logic for provider connections.
 * Depends on ModelLockStore for lock clearing on activate.
 */

import { getProviderConnectionById, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { buildClearLocks, getActiveLockKeys } from "open-sse/services/modelLockStore.js";

/** Account state enum */
export const ACCOUNT_STATE = {
  ACTIVE: "active",    // Normal, in rotation
  LOCKED: "locked",    // Auto cooldown from error, will expire
  PAUSED: "paused",    // Manual temporary disable, has expiresAt
  INACTIVE: "inactive",  // Permanent off (isActive=false)
};

/**
 * Activate a connection: set isActive=true, clear all model locks, reset error state.
 * BUG-T13 fix: if previous lastError indicates Kiro profile ARN issue, set needsArnRefresh=true
 * so getProviderCredentials can skip this connection until ARN is re-resolved.
 * @param {string} connectionId
 * @returns {Promise<object>} Updated connection
 */
export async function activate(connectionId) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  const clearLocks = buildClearLocks(conn);

  // BUG-T13 fix: detect Kiro stale ARN from previous lastError
  const lastErrorLower = (conn.lastError || '').toLowerCase();
  const needsArnRefresh = conn.provider === 'kiro'
    && (lastErrorLower.includes('arn') || lastErrorLower.includes('profile'));

  await updateProviderConnection(connectionId, {
    isActive: true,
    pausedUntil: null,
    testStatus: null,      // BUG-T06 + INKON-01 fix: don't claim "active" without verification
                           // clearAccountError() on next successful chat will set testStatus="active"
    lastError: null,
    lastErrorAt: null,
    backoffLevel: 0,
    deactivateReason: null,  // BUG-T02 fix: clear reason on activate
    needsArnRefresh: needsArnRefresh || null,  // BUG-T13: signal Kiro ARN needs re-resolve
    ...clearLocks,
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Deactivate a connection: set isActive=false and clear error state.
 * BUG-6 fix: Now clears error fields for clean deactivation (was preserving state).
 * Manual deactivation should start fresh if reactivated later.
 * INKON-10 fix: clear pausedUntil so scheduler doesn't auto-resume a manually deactivated connection.
 * BUG-T02 fix: optional reason param for audit trail.
 *
 * @param {string} connectionId
 * @param {string} [reason="manual"] - "manual" | "provider-toggle" | "ban"
 * @returns {Promise<object>} Updated connection
 */
export async function deactivate(connectionId, reason = "manual") {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  await updateProviderConnection(connectionId, {
    isActive: false,
    pausedUntil: null,     // INKON-10 fix: clear pausedUntil so scheduler doesn't auto-resume a manually deactivated connection
    testStatus: null,      // BUG-6 fix: clear error state on manual deactivate
    lastError: null,
    lastErrorAt: null,
    errorCode: null,
    backoffLevel: 0,
    deactivateReason: reason,  // BUG-T02 fix: store reason for audit trail
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Pause a connection temporarily.
 * Sets isActive=false with a pausedUntil timestamp.
 * Unlike deactivate, pause is time-bounded and can be auto-resolved.
 *
 * BUG-07 fix: never shorten an existing pause — only extend it.
 * If the connection already has a future pausedUntil longer than the new
 * duration, keep the existing expiry so callers can't accidentally truncate
 * a 24h QuotaMonitor pause with a 2min cooldown-path call.
 *
 * BUG-23 fix: also set testStatus="unavailable" so UI reflects the pause state
 * consistently (previously testStatus could stay "active" while isActive=false).
 *
 * @param {string} connectionId
 * @param {number} durationMs - How long to pause in ms
 * @returns {Promise<object>} Updated connection
 */
export async function pause(connectionId, durationMs) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  const newExpiry = Date.now() + durationMs;

  // BUG-07 fix: preserve a longer existing pause
  const existingExpiry = conn.pausedUntil
    ? new Date(conn.pausedUntil).getTime()
    : 0;
  const pausedUntil = new Date(
    Math.max(newExpiry, existingExpiry)
  ).toISOString();

  await updateProviderConnection(connectionId, {
    isActive: false,
    pausedUntil,
    testStatus: "unavailable",  // BUG-23 fix: keep testStatus consistent
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Set quota warning flag without pausing.
 * Connection stays active but marked with quotaStatus="warning".
 * Used by QuotaMonitor when quota data is unreliable.
 * Chat response is the source of truth for actual pause decisions.
 * @param {string} connectionId
 * @param {string} quotaStatus - "warning", "unknown", "exhausted", or null to clear
 * @param {string|null} message - Optional message describing the quota state
 * @returns {Promise<object>} Updated connection
 */
export async function setQuotaWarning(connectionId, quotaStatus, message = null) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  await updateProviderConnection(connectionId, {
    quotaStatus: quotaStatus || null,
    quotaWarningMessage: message || null,
    quotaWarningAt: quotaStatus ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Clear quota warning flag.
 * Called when chat succeeds after a quota warning.
 * @param {string} connectionId
 * @returns {Promise<object>} Updated connection
 */
export async function clearQuotaWarning(connectionId) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  await updateProviderConnection(connectionId, {
    quotaStatus: null,
    quotaWarningMessage: null,
    quotaWarningAt: null,
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Get the lifecycle state of a connection.
 * @param {string} connectionId
 * @returns {Promise<string>} One of ACCOUNT_STATE values
 */
export async function getState(connectionId) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  if (conn.isActive === false) {
    if (conn.pausedUntil && new Date(conn.pausedUntil).getTime() > Date.now()) {
      return ACCOUNT_STATE.PAUSED;
    }
    return ACCOUNT_STATE.INACTIVE;
  }

  const activeLocks = getActiveLockKeys(conn);
  if (activeLocks.length > 0) return ACCOUNT_STATE.LOCKED;

  return ACCOUNT_STATE.ACTIVE;
}

/**
 * Auto-resume any paused connections whose pausedUntil has passed.
 * Intended to be called periodically (e.g. from UsageScheduler).
 *
 * BUG-01 fix: reset testStatus, lastError, lastErrorAt, backoffLevel to active state.
 * BUG-02 fix: clear all modelLock_* fields (same as activate() does).
 *
 * @param {string} provider - Provider to check
 * @returns {Promise<string[]>} IDs of connections that were resumed
 */
export async function resumeExpiredPauses(provider) {
  const connections = await getProviderConnections({ provider, isActive: false });
  const now = Date.now();
  const resumed = [];

  for (const conn of connections) {
    if (!conn.pausedUntil) continue;
    if (new Date(conn.pausedUntil).getTime() > now) continue;

    // INKON-04 fix: skip connections with quotaStatus='exhausted' — QuotaMonitor Phase 2 handles these
    // via quota API verification before resuming. Auto-resuming exhausted quota connections would
    // immediately re-trigger chat errors and re-pause them, wasting requests.
    if (conn.quotaStatus === 'exhausted') continue;

    // BUG-01 + BUG-02 fix: full clean resume matching activate() behavior
    const clearLocks = buildClearLocks(conn);

    await updateProviderConnection(conn.id, {
      isActive: true,
      pausedUntil: null,
      testStatus: null,    // BUG-T06 fix: don't claim "active" without verification
      // clearAccountError() on next successful chat will set testStatus="active"
      lastError: null,
      lastErrorAt: null,
      backoffLevel: 0,
      ...clearLocks,
      updatedAt: new Date().toISOString(),
    });
    resumed.push(conn.id);
  }

  return resumed;
}
