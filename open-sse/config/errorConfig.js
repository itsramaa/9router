// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: 'invalid_request_error', code: 'bad_request' },
  401: { type: 'authentication_error', code: 'invalid_api_key' },
  402: { type: 'billing_error', code: 'payment_required' },
  403: { type: 'permission_error', code: 'insufficient_quota' },
  404: { type: 'invalid_request_error', code: 'model_not_found' },
  406: { type: 'invalid_request_error', code: 'model_not_supported' },
  429: { type: 'rate_limit_error', code: 'rate_limit_exceeded' },
  500: { type: 'server_error', code: 'internal_server_error' },
  502: { type: 'server_error', code: 'bad_gateway' },
  503: { type: 'server_error', code: 'service_unavailable' },
  504: { type: 'server_error', code: 'gateway_timeout' },
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: 'Bad request',
  401: 'Invalid API key provided',
  402: 'Payment required',
  403: 'You exceeded your current quota',
  404: 'Model not found',
  406: 'Model not supported',
  429: 'Rate limit exceeded',
  500: 'Internal server error',
  502: 'Bad gateway - upstream provider error',
  503: 'Service temporarily unavailable',
  504: 'Gateway timeout',
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15,
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,      // 2 min — auth errors, transient issues
  short: 5 * 1000,           // 5 sec — minor client errors
  quota: 24 * 60 * 60 * 1000, // 24 hours — quota/credit exhaustion (triggers lifecycle pause)
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff?, shouldFallback?, isRateLimit?, isQuotaExhausted?, isAuthError? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 *   - shouldFallback: false = do NOT cycle to next account (client error, not provider error)
 *   - isRateLimit: true = temporary rate limit (don't pause, just backoff)
 *   - isQuotaExhausted: true = hard quota cap (pause account)
 *   - isAuthError: true = authentication failure (pause account)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  { text: 'no credentials', cooldownMs: COOLDOWN.long, isAuthError: true },
  { text: 'request not allowed', cooldownMs: COOLDOWN.short },
  {
    text: 'improperly formed request',
    cooldownMs: COOLDOWN.long,
    shouldFallback: false,
  },

  // Rate limit patterns (temporary, per-minute throttling) — backoff, don't pause
  { text: 'rate limit', backoff: true, isRateLimit: true },
  { text: 'too many requests', backoff: true, isRateLimit: true },
  { text: 'requests per minute', backoff: true, isRateLimit: true },
  { text: 'rpm exceeded', backoff: true, isRateLimit: true },
  { text: 'request limit', backoff: true, isRateLimit: true },
  { text: 'throttled', backoff: true, isRateLimit: true },

  // Quota exhaustion patterns (monthly/daily hard cap) — pause account
  { text: 'quota exceeded', cooldownMs: COOLDOWN.quota, isQuotaExhausted: true },
  {
    text: 'insufficient credits',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'no credits remaining',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'credit limit reached',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'monthly limit reached',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'daily limit reached',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'usage limit exceeded',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  { text: 'plan limit', cooldownMs: COOLDOWN.quota, isQuotaExhausted: true },
  {
    text: 'subscription limit',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'You have reached the limit.',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  // xAI (Grok) spending-limit: 403 + "personal-team-blocked:spending-limit" / "run out of credits"
  {
    text: 'spending-limit',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'run out of credits',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },
  {
    text: 'out of credits',
    cooldownMs: COOLDOWN.quota,
    isQuotaExhausted: true,
  },

  // Server overload (temporary) — backoff, don't pause
  { text: 'capacity', backoff: true, isRateLimit: true },
  { text: 'overloaded', backoff: true, isRateLimit: true },
  { text: 'service unavailable', backoff: true, isRateLimit: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 400, cooldownMs: 0, shouldFallback: false }, // BUG-005: bad request — don't cycle accounts
  { status: 401, cooldownMs: COOLDOWN.quota, isAuthError: true },
  { status: 402, cooldownMs: COOLDOWN.quota, isQuotaExhausted: true },
  { status: 403, cooldownMs: COOLDOWN.quota, isAuthError: true },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true, isRateLimit: true }, // Default 429 = rate limit unless text matches quota
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};
