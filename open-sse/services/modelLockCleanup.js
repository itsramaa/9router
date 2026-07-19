/**
 * ModelLockCleanup
 * Periodic cleanup service for expired modelLock_* fields.
 * 
 * Expired locks are normally cleared when:
 * 1. A request succeeds for that model (via clearAccountError lazy cleanup)
 * 2. activate() is called (clears ALL locks)
 * 
 * But if an account is never used again, expired locks accumulate in the DB.
 * This service runs hourly to garbage-collect stale locks.
 */

import { getProviderConnections, updateProviderConnection } from '@/lib/localDb';
import { getExpiredLockKeys } from './modelLockStore.js';

/**
 * Scan all connections and clear expired modelLock_* fields.
 * Runs as a scheduled background task (registered in initializeApp.js).
 * @returns {Promise<void>}
 */
export async function runModelLockCleanup() {
  try {
    const connections = await getProviderConnections({});
    let cleanedCount = 0;
    let affectedConnections = 0;

    for (const conn of connections) {
      const expired = getExpiredLockKeys(conn);
      if (expired.length === 0) continue;

      const clearObj = Object.fromEntries(expired.map(k => [k, null]));
      
      try {
        await updateProviderConnection(conn.id, clearObj);
        cleanedCount += expired.length;
        affectedConnections++;
      } catch (e) {
        console.warn(
          `[ModelLockCleanup] Failed to clear locks for ${conn.id?.slice(0, 8)}: ${e.message}`
        );
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `[ModelLockCleanup] Cleared ${cleanedCount} expired lock(s) from ${affectedConnections} connection(s)`
      );
    }
  } catch (e) {
    console.error(`[ModelLockCleanup] Cleanup task failed: ${e.message}`);
  }
}