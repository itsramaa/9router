/**
 * ModelLockStore
 * Abstraction over per-model cooldown locks stored as flat fields on connection records.
 * Field format: modelLock_${model} = ISO timestamp expiry, or modelLock___all for account-level lock.
 * Extracted helpers from: open-sse/services/accountFallback.js
 */

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/**
 * Build the flat field key for a model lock.
 * @param {string|null} model
 * @returns {string}
 */
export function getLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Falls back to account-level lock (modelLock___all) if model-specific lock absent.
 * @param {object} connection - Connection record with flat modelLock_* fields
 * @param {string|null} model
 * @returns {boolean}
 */
export function isLockActive(connection, model) {
  const key = getLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Get the earliest active lock expiry ISO string across all modelLock_* fields.
 * Returns null if no active locks exist.
 * @param {object} connection
 * @returns {string|null}
 */
export function getEarliestLock(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build the DB update object to set a model lock on a connection.
 * @param {string|null} model
 * @param {number} cooldownMs
 * @returns {object} e.g. { modelLock_gpt-4o: "2026-06-21T..." }
 */
export function buildSetLock(model, cooldownMs) {
  const key = getLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build the DB update object to clear ALL model locks on a connection (set to null).
 * @param {object} connection
 * @returns {object}
 */
export function buildClearLocks(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Return keys of all expired modelLock_* fields on a connection.
 * Useful for lazy GC during clearAccountError.
 * @param {object} connection
 * @returns {string[]}
 */
export function getExpiredLockKeys(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([k, v]) => k.startsWith(MODEL_LOCK_PREFIX) && v && new Date(v).getTime() <= now)
    .map(([k]) => k);
}

/**
 * Return keys of all currently active modelLock_* fields on a connection.
 * @param {object} connection
 * @returns {string[]}
 */
export function getActiveLockKeys(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([k, v]) => k.startsWith(MODEL_LOCK_PREFIX) && v && new Date(v).getTime() > now)
    .map(([k]) => k);
}
