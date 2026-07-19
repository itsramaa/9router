/**
 * BUG-14 fix: single source of truth for ban keyword detection in UI components.
 *
 * Previously there were 3 inconsistent definitions:
 * - connectionStatus.js: ["banned","suspended","terminated","disabled","blocked","revoked"]
 * - ConnectionRow.js ([id]): ["banned","suspended","terminated","blocked","revoked"] — missing "disabled"
 * - ConnectionsCard.js: same as ConnectionRow, missing "disabled"
 *
 * This file is the canonical reference for all frontend ban detection.
 * Backend ban detection uses BAN_PATTERNS in open-sse/services/cooldownPolicy.js (full phrases).
 * Frontend uses single keywords for lastError substring matching in UI display logic.
 */

/** Keywords that indicate a permanent ban/suspension in connection.lastError */
export const BAN_KEYWORDS = [
  "banned",
  "suspended",
  "terminated",
  "disabled",
  "blocked",
  "revoked",
];

/**
 * Check if a connection's lastError indicates a ban/suspension.
 * @param {string|null|undefined} lastError
 * @returns {boolean}
 */
export function isBannedError(lastError) {
  if (!lastError) return false;
  const lower = lastError.toLowerCase();
  return BAN_KEYWORDS.some((k) => lower.includes(k));
}