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
 * @param {string} connectionId
 * @returns {Promise<object>} Updated connection
 */
export async function activate(connectionId) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  const clearLocks = buildClearLocks(conn);

  // Detect Kiro stale ARN from previous lastError
  const lastErrorLower = (conn.lastError || '').toLowerCase();
  const needsArnRefresh = conn.provider === 'kiro'
    && (lastErrorLower.includes('arn') || lastErrorLower.includes('profile'));

  await updateProviderConnection(connectionId, {
    isActive: true,
    pausedUntil: null,
    testStatus: null,
    lastError: null,
    lastErrorAt: null,
    backoffLevel: 0,
    deactivateReason: null,
    needsArnRefresh: needsArnRefresh || null,
    ...clearLocks,
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Deactivate a connection: set isActive=false and clear error state.
 * @param {string} connectionId
 * @param {string} [reason="manual"] - "manual" | "provider-toggle" | "ban"
 * @returns {Promise<object>} Updated connection
 */
export async function deactivate(connectionId, reason = "manual") {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  await updateProviderConnection(connectionId, {
    isActive: false,
    pausedUntil: null,
    testStatus: null,
    lastError: null,
    lastErrorAt: null,
    errorCode: null,
    backoffLevel: 0,
    deactivateReason: reason,
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Pause a connection temporarily.
 * Sets isActive=false with a pausedUntil timestamp.
 * Unlike deactivate, pause is time-bounded and can be auto-resolved.
 *
 * @param {string} connectionId
 * @param {number} durationMs - How long to pause in ms
 * @returns {Promise<object>} Updated connection
 */
export async function pause(connectionId, durationMs) {
  const conn = await getProviderConnectionById(connectionId);
  if (!conn) throw new Error(`Connection not found: ${connectionId}`);

  const newExpiry = Date.now() + durationMs;

  // Preserve a longer existing pause
  const existingExpiry = conn.pausedUntil
    ? new Date(conn.pausedUntil).getTime()
    : 0;
  const pausedUntil = new Date(
    Math.max(newExpiry, existingExpiry)
  ).toISOString();

  await updateProviderConnection(connectionId, {
    isActive: false,
    pausedUntil,
    testStatus: "unavailable",
    updatedAt: new Date().toISOString(),
  });

  return getProviderConnectionById(connectionId);
}

/**
 * Set quota warning flag without pausing.
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

    // Skip connections with quotaStatus='exhausted'
    if (conn.quotaStatus === 'exhausted') continue;

    const clearLocks = buildClearLocks(conn);

    await updateProviderConnection(conn.id, {
      isActive: true,
      pausedUntil: null,
      testStatus: null,
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