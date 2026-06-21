/**

 * QuotaStore

 * In-memory cache layer for provider quota data.

 * Interface is designed to be backend-agnostic — can be swapped to persistent store later.

 * BUG-010 fix: use global.__ to survive Next.js hot reload in dev mode.

 */

// Survive Next.js hot reload — module-level Map resets on reload

const g = (global.__quotaStore ??= { store: new Map() });

const store = g.store;

/**

 * Get cached quota for a connection. Returns null if not cached or expired.

 * @param {string} connectionId

 * @returns {object|null}

 */

export function get(connectionId) {
  const entry = store.get(connectionId);

  if (!entry) return null;

  if (Date.now() > entry.fetchedAt + entry.ttlMs) {
    store.delete(connectionId);

    return null;
  }

  return entry.data;
}

/**

 * Store quota data for a connection with TTL.

 * @param {string} connectionId

 * @param {object} data - Quota data from provider API

 * @param {number} [ttlMs=60000] - Cache TTL in ms (default 60s)

 */

export function set(connectionId, data, ttlMs = 60_000) {
  store.set(connectionId, { data, fetchedAt: Date.now(), ttlMs });
}

/**

 * Check if cached quota is stale (expired or missing).

 * @param {string} connectionId

 * @param {number} [ttlMs=60000]

 * @returns {boolean}

 */

export function isStale(connectionId, ttlMs = 60_000) {
  const entry = store.get(connectionId);

  if (!entry) return true;

  return Date.now() > entry.fetchedAt + ttlMs;
}

/**

 * Invalidate cache for a specific connection.

 * @param {string} connectionId

 */

export function invalidate(connectionId) {
  store.delete(connectionId);
}

/**

 * Invalidate all cached quota entries.

 */

export function invalidateAll() {
  store.clear();
}

/**

 * Get cache metadata for a connection (fetchedAt, ttlMs, remaining TTL).

 * @param {string} connectionId

 * @returns {{ fetchedAt: number, ttlMs: number, remainingMs: number }|null}

 */

export function getMeta(connectionId) {
  const entry = store.get(connectionId);

  if (!entry) return null;

  return {
    fetchedAt: entry.fetchedAt,

    ttlMs: entry.ttlMs,

    remainingMs: Math.max(0, entry.fetchedAt + entry.ttlMs - Date.now()),
  };
}
