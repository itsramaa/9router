/**
 * QuotaMonitor
 * Proactive quota analysis service. Runs periodically via UsageScheduler to:
 * 1. Analyze cached/fresh quota data per-provider
 * 2. Set WARNING flags when quota looks exhausted (but DO NOT auto-pause)
 * 3. Verify and recover paused accounts when quota resets
 *
 * CHAT-FIRST PAUSE POLICY:
 * Quota sync/tracker data is NOT authoritative for pausing. Only actual chat
 * errors (401/403/402/429-quota-exhausted) trigger pauses via markAccountUnavailable().
 * This monitor only sets informational warnings to help users understand quota state.
 */

import {
  getProviderConnections,
  updateProviderConnection,
} from '@/lib/localDb';

import { getUsageForProvider } from './usage.js';
import * as QuotaStore from './quotaStore.js';
import {
  activate as lifecycleActivate,
  pause as lifecyclePause,
  setQuotaWarning,
  clearQuotaWarning,
} from '@/shared/services/accountLifecycle';
import { resolveConnectionProxyConfig } from '@/lib/network/connectionProxy';
import { refreshTokenByProvider } from './tokenRefresh.js';

// Providers that have quota APIs and should be monitored.
// NOTE: xAI is intentionally excluded — xAI does not expose a public quota/usage API.
// xAI quota exhaustion (spending-limit) is detected via chat-first policy:
// text-rule "spending-limit" in errorConfig.js → classifyError → isQuotaExhausted → pause 24h.
// Auto-recovery for xAI is purely time-based via resumeExpiredPauses() (no quota verification).
export const QUOTA_SUPPORTED_PROVIDERS = new Set([
  'claude',
  'github',
  'codex',
  'kiro',
  'gemini-cli',
  'antigravity',
  'qoder',
]);

const MAX_PAUSE_WITHOUT_RESET_MS = 24 * 60 * 60 * 1000; // 24h: default pause when no resetAt

/**
 * Determine if quota appears exhausted based on provider-specific logic.
 * Returns quota status info for warning purposes (NOT for auto-pause).
 *
 * @param {string} provider
 * @param {object} usageData - result from getUsageForProvider
 * @returns {{ exhausted: boolean, resetAt?: string, message?: string }}
 */
export function analyzeQuota(provider, usageData) {
  if (!usageData || typeof usageData !== 'object') return { exhausted: false };
  if (usageData.error) return { exhausted: false };
  if (usageData.message && Object.keys(usageData.quotas || {}).length === 0) {
    return { exhausted: false };
  }

  // ─── Claude ──────────────────────────────────────────────────────────────
  if (provider === 'claude') {
    const weekly = usageData.quotas?.['weekly (7d)'];
    const session = usageData.quotas?.['session (5h)'];

    if (
      weekly &&
      typeof weekly.remaining === 'number' &&
      weekly.remaining === 0 &&
      weekly.resetAt
    ) {
      return {
        exhausted: true,
        resetAt: weekly.resetAt,
        message: 'Weekly quota exhausted',
      };
    }

    if (
      session &&
      typeof session.remaining === 'number' &&
      session.remaining === 0 &&
      session.resetAt
    ) {
      return {
        exhausted: true,
        resetAt: session.resetAt,
        message: 'Session quota exhausted',
      };
    }

    return { exhausted: false };
  }

  // ─── GitHub Copilot ───────────────────────────────────────────────────────
  if (provider === 'github') {
    const quotas = usageData.quotas || {};
    const nonUnlimited = Object.values(quotas).filter((q) => q && !q.unlimited);

    if (
      nonUnlimited.length > 0 &&
      nonUnlimited.every((q) => (q.remaining ?? 1) === 0)
    ) {
      const resetTimes = nonUnlimited.map((q) => q.resetAt).filter(Boolean);
      const earliest = resetTimes.sort()[0] || null;
      return {
        exhausted: true,
        resetAt: earliest,
        message: 'All quotas exhausted',
      };
    }

    return { exhausted: false };
  }

  // ─── Codex (OpenAI) ──────────────────────────────────────────────────────
  if (provider === 'codex') {
    if (usageData.limitReached === true) {
      const sessionReset =
        usageData.quotas?.session?.resetAt ||
        usageData.quotas?.['session']?.resetAt;
      const weeklyReset =
        usageData.quotas?.weekly?.resetAt ||
        usageData.quotas?.['weekly']?.resetAt;
      const resetAt = sessionReset || weeklyReset || null;
      return { exhausted: true, resetAt, message: 'Rate limit reached' };
    }

    return { exhausted: false };
  }

  // ─── Kiro (AWS CodeWhisperer) ─────────────────────────────────────────────
  if (provider === 'kiro') {
    const quotas = usageData.quotas || {};
    const exhausted = Object.values(quotas).find(
      (q) => q && !q.unlimited && (q.remaining ?? 1) === 0
    );

    if (exhausted) {
      return {
        exhausted: true,
        resetAt: exhausted.resetAt,
        message: 'Quota exhausted',
      };
    }

    return { exhausted: false };
  }

  // ─── Antigravity / Gemini-CLI (per-model) ─────────────────────────────────
  if (provider === 'antigravity' || provider === 'gemini-cli') {
    const quotas = usageData.quotas || {};
    const exhaustedModels = [];

    for (const [modelId, q] of Object.entries(quotas)) {
      if (!q || q.unlimited) continue;

      const remainingPct =
        typeof q.remainingPercentage === 'number'
          ? q.remainingPercentage
          : (q.remaining ?? 1);

      if (remainingPct === 0) exhaustedModels.push(modelId);
    }

    if (exhaustedModels.length > 0) {
      return {
        exhausted: true,
        message: `Models exhausted: ${exhaustedModels.join(', ')}`,
      };
    }

    return { exhausted: false };
  }

  // ─── Qoder ────────────────────────────────────────────────────────────────
  if (provider === 'qoder') {
    if (usageData.isQuotaExceeded === true) {
      return { exhausted: true, message: 'Quota exceeded' };
    }

    return { exhausted: false };
  }

  return { exhausted: false };
}

/**
 * Check if a quota result indicates quota has recovered (remaining > 0 on at least one metric).
 * @param {string} provider
 * @param {object} usageData
 * @returns {boolean}
 */
export function isQuotaRecovered(provider, usageData) {
  if (!usageData || typeof usageData !== 'object') return false;
  if (usageData.error) return false;

  if (provider === 'qoder') return usageData.isQuotaExceeded !== true;
  if (provider === 'codex') return usageData.limitReached !== true;

  const quotas = usageData.quotas;
  if (!quotas || typeof quotas !== 'object') return true;

  const values = Object.values(quotas).filter((q) => q && !q.unlimited);
  if (values.length === 0) return true;

  return values.some(
    (q) =>
      (typeof q.remaining === 'number'
        ? q.remaining
        : (q.remainingPercentage ?? 1)) > 0
  );
}

/**
 * Build proxyOptions from a connection's providerSpecificData.
 */
async function buildProxyOptions(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(
    connection.providerSpecificData || {}
  );

  return {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || '',
    connectionNoProxy: proxyConfig.connectionNoProxy || '',
    vercelRelayUrl: proxyConfig.vercelRelayUrl || '',
    strictProxy: false,
  };
}

/**
 * BUG-012 fix: refresh OAuth token before fetching usage if it's expiring soon.
 * Avoids 401 errors causing quota monitor to skip the connection entirely.
 */
async function getConnWithFreshToken(provider, conn) {
  if (!conn.refreshToken || !conn.expiresAt) return conn;

  const expiresAtMs = new Date(conn.expiresAt).getTime();
  // Refresh if expiring within 10 minutes
  if (expiresAtMs - Date.now() > 10 * 60 * 1000) return conn;

  try {
    const refreshed = await refreshTokenByProvider(provider, conn);
    if (refreshed?.accessToken) {
      return { ...conn, accessToken: refreshed.accessToken };
    }
  } catch {
    // Non-fatal: fall through with existing token
  }

  return conn;
}

/**
 * Main QuotaMonitor tick. Called by UsageScheduler every 10 minutes.
 *
 * CHAT-FIRST PAUSE POLICY:
 * - Phase 1: Set WARNING flags when quota looks exhausted, but DO NOT auto-pause.
 *   Chat errors are the source of truth for pausing (handled by markAccountUnavailable).
 * - Phase 2: Check recovery for paused connections and auto-resume if quota recovered.
 *   BUG-11 fix: lifecyclePause now preserves longer existing pauses (won't shorten them).
 *   BUG-17 fix: re-pause path now updates lastError so user sees reason in UI.
 */
export async function runQuotaMonitorTick() {
  const now = Date.now();

  // ── Phase 1: Active connections — set warnings only (NO auto-pause) ──
  for (const provider of QUOTA_SUPPORTED_PROVIDERS) {
    let connections;
    try {
      connections = await getProviderConnections({ provider, isActive: true });
    } catch (e) {
      console.warn(
        `[QuotaMonitor] failed to fetch connections for ${provider}: ${e.message}`
      );
      continue;
    }

    for (const conn of connections) {
      try {
        let usageData = QuotaStore.get(conn.id);

        if (!usageData) {
          const freshConn = await getConnWithFreshToken(provider, conn); // BUG-012
          const proxyOptions = await buildProxyOptions(conn);
          usageData = await getUsageForProvider(freshConn, proxyOptions);
          if (usageData && !usageData.error) {
            QuotaStore.set(conn.id, usageData, 10 * 60 * 1000);
          }
        }

        if (!usageData) continue;

        // Skip if quota fetch failed (API unavailable, timeout, etc.)
        if (usageData.error) {
          // Don't set warning — quota data is unreliable, just skip
          continue;
        }

        const status = analyzeQuota(provider, usageData);

        if (!status.exhausted) {
          // Quota looks healthy — clear any existing warnings
          if (conn.quotaStatus === 'exhausted') {
            await clearQuotaWarning(conn.id);
            console.log(
              `[QuotaMonitor] ${provider}/${conn.id.slice(0, 8)} quota OK → cleared warning`
            );
          }
          continue;
        }

        // Quota looks exhausted — set warning but DO NOT pause
        // Chat errors will trigger actual pause via markAccountUnavailable()
        let warningMessage = status.message || 'Quota appears exhausted';
        if (status.resetAt) {
          warningMessage += ` (expected reset: ${status.resetAt})`;
        }

        await setQuotaWarning(conn.id, 'exhausted', warningMessage);
        console.log(
          `[QuotaMonitor] ${provider}/${conn.id.slice(0, 8)} WARNING: ${warningMessage} (staying active, waiting for chat confirmation)`
        );
      } catch (e) {
        console.warn(
          `[QuotaMonitor] error processing ${provider}/${conn.id.slice(0, 8)}: ${e.message}`
        );
      }
    }
  }

  // ── Phase 2: Paused connections — verify quota recovery ──────────────────
  // Note: These are connections paused by chat errors (markAccountUnavailable), not quota monitor
  for (const provider of QUOTA_SUPPORTED_PROVIDERS) {
    let paused;
    try {
      paused = await getProviderConnections({ provider, isActive: false });
    } catch (e) {
      continue;
    }

    const expired = paused.filter((c) => {
      if (!c.pausedUntil) return false;
      return new Date(c.pausedUntil).getTime() <= now;
    });

    for (const conn of expired) {
      try {
        QuotaStore.invalidate(conn.id);
        const freshConn = await getConnWithFreshToken(provider, conn); // BUG-012
        const proxyOptions = await buildProxyOptions(conn);
        const usageData = await getUsageForProvider(freshConn, proxyOptions);

        if (usageData && isQuotaRecovered(provider, usageData)) {
          await lifecycleActivate(conn.id);
          await clearQuotaWarning(conn.id);
          QuotaStore.set(conn.id, usageData, 10 * 60 * 1000);
          console.log(
            `[QuotaMonitor] ${provider}/${conn.id.slice(0, 8)} RECOVERED → activated`
          );
        } else {
          // BUG-17 fix: update lastError so user sees why connection is still paused in UI
          // BUG-11 fix: lifecyclePause preserves longer existing pause (won't shorten a 24h pause)
          const rejectReason = usageData
            ? 'Quota still exhausted (re-verified by quota monitor)'
            : 'Quota check failed — could not verify recovery';

          await lifecyclePause(conn.id, MAX_PAUSE_WITHOUT_RESET_MS);

          try {
            await updateProviderConnection(conn.id, {
              lastError: rejectReason,
              lastErrorAt: new Date().toISOString(),
            });
          } catch {
            /* non-fatal — pause already set */
          }

          console.log(
            `[QuotaMonitor] ${provider}/${conn.id.slice(0, 8)} still exhausted → re-paused 24h`
          );
        }
      } catch (e) {
        console.warn(
          `[QuotaMonitor] recovery check failed ${provider}/${conn.id.slice(0, 8)}: ${e.message}`
        );
      }
    }
  }
}