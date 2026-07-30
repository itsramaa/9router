import { isBannedError } from "@/shared/utils/connectionBanDetect";

/**
 * Badge variant from connection lifecycle state.
 * Extra args are optional so existing 2-arg callers keep working.
 */
export function getStatusVariant(
  isActive,
  effectiveStatus,
  pausedUntil = null,
  lastError = null,
) {
  if (isActive === false) {
    if (isBannedError(lastError)) return "destructive";
    if (pausedUntil && new Date(pausedUntil).getTime() > Date.now()) return "warning";
    return "default";
  }
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (
    effectiveStatus === "error" ||
    effectiveStatus === "expired" ||
    effectiveStatus === "unavailable"
  )
    return "error";
  return "default";
}