/**
 * CooldownPolicy
 * Centralized error classification and cooldown calculation.
 * Extracted from: open-sse/config/errorConfig.js + open-sse/services/accountFallback.js
 * + src/sse/services/auth.js (resetsAtMs override logic).
 *
 * CHAT-FIRST PAUSE POLICY:
 * - Rate limits (isRateLimit) → backoff only, don't pause unless escalated
 * - Quota exhaustion (isQuotaExhausted) → pause account
 * - Auth errors (isAuthError) → pause account
 * - Ban patterns → deactivate account
 */

import {
  ERROR_RULES,
  BACKOFF_CONFIG,
  TRANSIENT_COOLDOWN_MS,
} from '../config/errorConfig.js';

/**
 * Patterns that indicate a permanent ban or account suspension.
 * Match is case-insensitive substring against the full error message.
 * action: "deactivate" is returned when any pattern matches.
 */
export const BAN_PATTERNS = [
  'account suspended',
  'account banned',
  'account disabled',
  'account has been suspended',
  'account has been terminated',
  'account terminated',
  'user is deactivated',
  'this account has been blocked',
  'access revoked',
  'account closed',
  'your account has been suspended',
  'your account has been disabled',
];

/**
 * backoffLevel threshold to escalate from "lock" to "pause".
 * At this level the account has failed enough times consecutively
 * that quota exhaustion is likely — pause it rather than keep locking per-model.
 *
 * CHAT-FIRST POLICY: Only reached through repeated rate limit errors.
 * Quota exhaustion and auth errors pause immediately without escalation.
 */
export const ESCALATION_THRESHOLD = 8;

/** Max cooldown for provider-reported rate limit resets (30 min) */
const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * BUG-09 fix: Threshold (1h) above which action="pause" triggers lifecyclePause()
 * instead of per-model lock. Exported as single source of truth — consumed by
 * auth.js markAccountUnavailable() and quotaMonitor.js.
 * @see src/sse/services/auth.js — markAccountUnavailable
 * @see open-sse/services/quotaMonitor.js
 */
export const LOCK_VS_PAUSE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Calculate milliseconds until the 1st day of next month (UTC).
 * Used for monthly quota exhaustion (e.g. MONTHLY_REQUEST_COUNT).
 * @returns {number} milliseconds until next month starts
 */
export function msUntilNextMonth() {
  const now = new Date();
  const nextMonth = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1,
      0,
      0,
      0,
      0
    )
  );
  return Math.max(nextMonth.getTime() - now.getTime(), 60 * 1000); // At least 1 minute
}

/**
 * Calculate exponential backoff cooldown for rate limits.
 * Level 1: 2s, Level 2: 4s, Level 3: 8s … cap at BACKOFF_CONFIG.max (5 min).
 * @param {number} backoffLevel
 * @returns {number} cooldown in ms
 */
export function computeCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  return Math.min(BACKOFF_CONFIG.base * Math.pow(2, level), BACKOFF_CONFIG.max);
}

/**
 * Classify an upstream error and return cooldown + next backoff level + action.
 * Checks ERROR_RULES top-to-bottom: text rules first, then status rules.
 *
 * CHAT-FIRST PAUSE POLICY:
 * - isRateLimit errors → backoff only, action="lock" unless escalated to threshold
 * - isQuotaExhausted errors → immediate pause, action="pause"
 * - isAuthError errors → immediate pause, action="pause"
 * - Ban patterns → action="deactivate"
 *
 * BUG-005 fix: rules with shouldFallback: false return immediately without cycling accounts.
 *
 * BUG-08 fix: quota exhaustion and auth error rules now return newBackoffLevel
 * so the caller can always update backoffLevel consistently (previously these
 * paths omitted newBackoffLevel, leaving backoffLevel stale on the connection).
 *
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message from upstream
 * @param {number} [backoffLevel=0] - Current backoff level for this account
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, action: "lock"|"pause"|"deactivate", isRateLimit?: boolean, isQuotaExhausted?: boolean, isAuthError?: boolean }}
 */
export function classifyError(status, errorText, backoffLevel = 0) {
  const lower = errorText
    ? (typeof errorText === 'string'
        ? errorText
        : JSON.stringify(errorText)
      ).toLowerCase()
    : '';

  // Ban detection takes priority over everything else
  if (lower && BAN_PATTERNS.some((p) => lower.includes(p))) {
    return {
      shouldFallback: true,
      cooldownMs: 0,
      newBackoffLevel: backoffLevel,
      action: 'deactivate',
      isAuthError: true,
    };
  }

  for (const rule of ERROR_RULES) {
    if (rule.text && lower && lower.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        const cooldownMs = computeCooldown(newLevel);
        // CHAT-FIRST: Rate limits escalate to pause only at threshold
        const action = newLevel >= ESCALATION_THRESHOLD ? 'pause' : 'lock';
        return {
          shouldFallback: true,
          cooldownMs,
          newBackoffLevel: newLevel,
          action,
          isRateLimit: rule.isRateLimit,
          isQuotaExhausted: rule.isQuotaExhausted,
          isAuthError: rule.isAuthError,
        };
      }

      // Quota exhaustion or auth error → immediate pause (CHAT-FIRST POLICY)
      // BUG-08 fix: include newBackoffLevel so caller can update backoffLevel consistently
      if (rule.isQuotaExhausted || rule.isAuthError) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return {
          shouldFallback: true,
          cooldownMs: rule.cooldownMs ?? 0,
          newBackoffLevel: newLevel,
          action: 'pause',
          isQuotaExhausted: rule.isQuotaExhausted,
          isAuthError: rule.isAuthError,
        };
      }

      // BUG-005: respect shouldFallback: false for non-retryable client errors
      if (rule.shouldFallback === false) {
        return {
          shouldFallback: false,
          cooldownMs: rule.cooldownMs ?? 0,
          action: 'lock',
          isRateLimit: rule.isRateLimit,
        };
      }

      return {
        shouldFallback: true,
        cooldownMs: rule.cooldownMs,
        action: 'lock',
        isRateLimit: rule.isRateLimit,
      };
    }

    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        const cooldownMs = computeCooldown(newLevel);
        // CHAT-FIRST: Rate limits escalate to pause only at threshold
        const action = newLevel >= ESCALATION_THRESHOLD ? 'pause' : 'lock';
        return {
          shouldFallback: true,
          cooldownMs,
          newBackoffLevel: newLevel,
          action,
          isRateLimit: rule.isRateLimit,
          isQuotaExhausted: rule.isQuotaExhausted,
          isAuthError: rule.isAuthError,
        };
      }

      // Quota exhaustion or auth error → immediate pause (CHAT-FIRST POLICY)
      // BUG-08 fix: include newBackoffLevel
      if (rule.isQuotaExhausted || rule.isAuthError) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return {
          shouldFallback: true,
          cooldownMs: rule.cooldownMs ?? 0,
          newBackoffLevel: newLevel,
          action: 'pause',
          isQuotaExhausted: rule.isQuotaExhausted,
          isAuthError: rule.isAuthError,
        };
      }

      // BUG-005: respect shouldFallback: false for non-retryable client errors
      if (rule.shouldFallback === false) {
        return {
          shouldFallback: false,
          cooldownMs: rule.cooldownMs ?? 0,
          action: 'lock',
          isRateLimit: rule.isRateLimit,
        };
      }

      return {
        shouldFallback: true,
        cooldownMs: rule.cooldownMs,
        action: 'lock',
        isRateLimit: rule.isRateLimit,
      };
    }
  }

  return {
    shouldFallback: true,
    cooldownMs: TRANSIENT_COOLDOWN_MS,
    action: 'lock',
  };
}

/**
 * Apply a provider-reported precise reset timestamp (e.g. Codex resets_at).
 *
 * CHAT-FIRST FIX: This function does NOT decide the action type on its own.
 * It returns the cooldownMs only. The caller (resolveCooldown) determines
 * the action based on whether the error is a rate limit vs quota exhaustion.
 * Rate limits with resets_at should still be "lock" not "pause".
 *
 * Returns null if resetsAtMs is not in the future.
 * @param {number|null} resetsAtMs - Epoch ms when quota resets
 * @returns {{ cooldownMs: number } | null}
 */
export function applyPreciseCooldown(resetsAtMs) {
  if (!resetsAtMs || resetsAtMs <= Date.now()) return null;
  const cooldownMs = resetsAtMs - Date.now();
  return { cooldownMs };
}

/**
 * Resolve the best cooldown strategy given a status, errorText, backoffLevel,
 * and optional provider-reported resetsAtMs.
 * Single entry point used by auth.js markAccountUnavailable.
 *
 * CHAT-FIRST PAUSE POLICY:
 * - Ban patterns → deactivate (highest priority, handled by classifyError)
 * - Classify error first to determine action type (lock vs pause vs deactivate)
 * - If provider reported a precise reset time, use it as cooldown duration
 *   but KEEP the action type from classifyError (lock for rate limits, pause for quota/auth)
 * - Rate limits with resets_at are capped at 30 min to avoid false-pausing
 *
 * BUG-5 fix: Removed duplicate ban detection (now only in classifyError)
 *
 * @param {number} status
 * @param {string} errorText
 * @param {number} backoffLevel
 * @param {number|null} [resetsAtMs]
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number, action: "lock"|"pause"|"deactivate", isRateLimit?: boolean, isQuotaExhausted?: boolean, isAuthError?: boolean }}
 */
export function resolveCooldown(
  status,
  errorText,
  backoffLevel = 0,
  resetsAtMs = null
) {
  // BUG-5 fix: Duplicate ban detection removed from here
  // Ban patterns are now only checked in classifyError() for single source of truth
  
  // Classify the error first to determine the action type
  const classified = classifyError(status, errorText, backoffLevel);

  // If provider reported a precise reset time, use it as cooldown duration
  // but KEEP the action type from classifyError (lock for rate limits, pause for quota/auth)
  const precise = applyPreciseCooldown(resetsAtMs);

  if (precise) {
    // For rate limits, cap the precise cooldown to 30 min
    // to avoid false-pausing on long rate limit windows (e.g. Codex 5-6h resets_at)
    let cooldownMs = precise.cooldownMs;

    if (
      classified.isRateLimit &&
      !classified.isQuotaExhausted &&
      !classified.isAuthError
    ) {
      cooldownMs = Math.min(cooldownMs, MAX_RATE_LIMIT_COOLDOWN_MS);
    }

    return {
      ...classified,
      cooldownMs,
      shouldFallback: true,
    };
  }

  return classified;
}
