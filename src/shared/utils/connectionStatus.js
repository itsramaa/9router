/**

 * Returns the Badge variant for a provider connection based on its lifecycle state.

 * @param {boolean|undefined} isActive

 * @param {string|undefined} effectiveStatus

 * @param {string|null} [pausedUntil] - ISO timestamp from AccountLifecycle.pause()

 * @param {string|null} [lastError] - last error message, used for ban detection

 * @returns {"success"|"error"|"warning"|"destructive"|"default"}

 */

// BUG-14 fix: import from shared util instead of local definition

import { isBannedError } from '@/shared/utils/connectionBanDetect';

export function getStatusVariant(
  isActive,
  effectiveStatus,
  pausedUntil = null,
  lastError = null
) {
  if (isActive === false) {
    // Ban detected from lastError

    if (isBannedError(lastError)) {
      return 'destructive'; // red
    }

    // Auto-paused by QuotaMonitor — has a future expiry

    if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) {
      return 'warning'; // orange
    }

    // Manual disable

    return 'default'; // gray
  }

  if (effectiveStatus === 'active' || effectiveStatus === 'success')
    return 'success';

  if (
    effectiveStatus === 'error' ||
    effectiveStatus === 'expired' ||
    effectiveStatus === 'unavailable'
  )
    return 'error';

  return 'default';
}
