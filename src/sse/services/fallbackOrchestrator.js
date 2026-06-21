/**



 * FallbackOrchestrator



 * Generic retry-with-fallback loop extracted from handler files.



 * Handles: credential selection → execute → on error: lock + exclude + retry → on exhausted: unavailableResponse.



 *



 * Each handler passes its own execute() function which calls the core (chatCore, embeddingsCore, etc.)



 * The orchestrator owns the retry loop and account exclusion logic.



 */

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
} from '@/sse/services/auth.js';

import { errorResponse, unavailableResponse } from 'open-sse/utils/error.js';

import { HTTP_STATUS } from 'open-sse/config/runtimeConfig.js';

import * as log from '@/sse/utils/logger.js';

import { classifyError } from 'open-sse/services/cooldownPolicy.js';

/**



 * @typedef {object} FallbackOptions



 * @property {string} provider



 * @property {string} model



 * @property {Function} execute - async (credentials) => result: { success, response, status, error, resetsAtMs? }



 * @property {Function} [onSuccess] - async (credentials) => void — called after successful execute



 * @property {Function} [onCredentialsSelected] - async (credentials) => credentials — hook to refresh/augment creds before execute



 * @property {string} [logPrefix] - Label for log messages (default: provider/model)



 */

/**



 * Run a provider request with automatic account fallback.



 * Retries with the next available account on any error that shouldFallback=true.



 * Returns the first successful Response, or an error/unavailable Response when all accounts exhausted.



 *



 * @param {FallbackOptions} options



 * @returns {Promise<Response>}



 */

export async function runWithFallback({
  provider,

  model,

  execute,

  onSuccess = null,

  onCredentialsSelected = null,

  logPrefix = null,
}) {
  const tag = logPrefix || `${provider}/${model}`;

  const excludeConnectionIds = new Set();

  let lastError = null;

  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(
      provider,

      excludeConnectionIds,

      model
    );

    // All accounts unavailable / rate-limited

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || 'Unavailable';

        const status =
          lastStatus ||
          Number(credentials.lastErrorCode) ||
          HTTP_STATUS.SERVICE_UNAVAILABLE;

        log.warn(
          'FALLBACK',

          `[${tag}] ${errorMsg} (${credentials.retryAfterHuman})`
        );

        return unavailableResponse(
          status,

          `[${tag}] ${errorMsg}`,

          credentials.retryAfter,

          credentials.retryAfterHuman
        );
      }

      if (excludeConnectionIds.size === 0) {
        log.warn('AUTH', `No active credentials for provider: ${provider}`);

        return errorResponse(
          HTTP_STATUS.NOT_FOUND,

          `No active credentials for provider: ${provider}`
        );
      }

      log.warn('FALLBACK', `[${tag}] No more accounts available`);

      return errorResponse(
        lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,

        lastError || 'All accounts unavailable'
      );
    }

    log.info(
      'AUTH',

      `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`
    );

    // Hook: allow caller to refresh/augment credentials before execute (e.g. token refresh, projectId resolve)

    let effectiveCredentials = credentials;

    if (onCredentialsSelected) {
      try {
        effectiveCredentials =
          (await onCredentialsSelected(credentials)) || credentials;
      } catch (e) {
        log.warn(
          'FALLBACK',

          `[${tag}] onCredentialsSelected error: ${e.message}`
        );
      }
    }

    const result = await execute(effectiveCredentials);

    if (result.success) {
      if (onSuccess) {
        try {
          await onSuccess(credentials);
        } catch (e) {
          log.warn('FALLBACK', `[${tag}] onSuccess error: ${e.message}`);
        }
      }

      return result.response;
    }

    // BUG-019 fix: non-retryable client errors should not cycle through all accounts

    // 400 (bad request), 404 (not found) are client-side issues that don't warrant cycling

    //

    // BUG-04 fix: 401/403 (auth errors) should still call markAccountUnavailable to

    // update backoff level and lastError, but we don't cycle to the next account.

    // These are client-side auth issues (invalid token, insufficient permissions) that

    // affect this specific request, not systemic provider failures.

    const s = result.status;

    if (s >= 400 && s < 500 && s !== 429 && s !== 402) {
      // For 401/403, still mark account unavailable (updates backoff level, lastError)
      // but don't cycle to next account since this is a client-side auth issue
      if (s === 401 || s === 403) {
        // Quota/auth exhaustion on 403 should still fallback to next account
        // (e.g. xAI spending-limit returns 403, not a client-side auth issue)
        const classified = classifyError(s, result.error);
        if (classified.isQuotaExhausted || (classified.isAuthError && classified.shouldFallback)) {
          const { shouldFallback } = await markAccountUnavailable(
            credentials.connectionId,
            result.status,
            result.error,
            provider,
            model,
            result.resetsAtMs || null
          );
          if (shouldFallback) {
            log.warn(
              'AUTH',
              `Account ${credentials.connectionName} quota/auth exhausted (${result.status}), trying fallback`
            );
            excludeConnectionIds.add(credentials.connectionId);
            lastError = result.error;
            lastStatus = result.status;
            continue;
          }
          return result.response;
        }
        
        const { shouldFallback: shouldFallbackAuth } = await markAccountUnavailable(
          credentials.connectionId,
          result.status,
          result.error,
          provider,
          model,
          result.resetsAtMs || null
        );
        
        // BUG-2 fix: check shouldFallback before returning
        // Some 401/403 errors (e.g. temporary auth issues) should retry next account
        if (shouldFallbackAuth) {
          log.warn(
            'AUTH',
            `Account ${credentials.connectionName} auth error with fallback (${result.status}), trying next account`
          );
          excludeConnectionIds.add(credentials.connectionId);
          lastError = result.error;
          lastStatus = result.status;
          continue;
        }
      }
      
      log.warn('FALLBACK', `[${tag}] client error ${s} — not cycling accounts`);
      return result.response;
    }

    // Mark account unavailable and decide whether to fallback
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,

      result.status,

      result.error,

      provider,

      model,

      result.resetsAtMs || null
    );

    if (shouldFallback) {
      log.warn(
        'AUTH',

        `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`
      );

      excludeConnectionIds.add(credentials.connectionId);

      lastError = result.error;

      lastStatus = result.status;

      continue;
    }

    return result.response;
  }
}
