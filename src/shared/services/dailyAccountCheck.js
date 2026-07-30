/**
 * DailyAccountCheck
 * Setiap pergantian hari UTC: ping semua provider connections via chat (max_tokens=1)
 * dan update testStatus + lifecycle (activate / deactivate / pause) berdasarkan hasil.
 *
 * Timer: setTimeout rekursif ke midnight UTC — zero polling overhead.
 * Singleton: global.__dailyAccountCheck survive Next.js hot reload.
 */

import { getProviderConnections, updateProviderConnection, getApiKeys } from '@/lib/localDb';
import {
  activate,
  deactivate,
  pause,
} from '@/shared/services/accountLifecycle';
import { UPDATER_CONFIG } from '@/shared/constants/config';
import { getConsistentMachineId } from '@/shared/utils/machineId';

const CLI_TOKEN_SALT = '9r-cli-auth';
const PING_TIMEOUT_MS = 15_000;
const PAUSE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

// Singleton guard — survive Next.js hot reload
const g = (global.__dailyAccountCheck ??= {
  timer: null,
  running: false,
});

/**
 * Hitung millisecond sampai midnight UTC berikutnya.
 * Minimal 1000ms untuk menghindari scheduling terlalu dekat.
 */
export function msUntilMidnightUTC() {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.max(midnight.getTime() - Date.now(), 1000);
}

/**
 * Klasifikasi hasil ping ke action lifecycle.
 * @param {{ ok: boolean, status: number, error: string|null }} result
 * @returns {'activate' | 'deactivate' | 'pause' | 'skip'}
 */
export function classifyPingResult(result) {
  if (result.ok) return 'activate';

  const status = result.status ?? 0;
  const errorLower = (result.error || '').toLowerCase();

  // Auth error → deactivate
  if (status === 401 || status === 403) return 'deactivate';

  // Quota / rate limit → pause 24h
  if (
    status === 402 ||
    status === 429 ||
    errorLower.includes('quota') ||
    errorLower.includes('rate limit') ||
    errorLower.includes('limit reached') ||
    errorLower.includes('billing')
  ) return 'pause';

  // Network error, timeout, 5xx → skip (jangan ubah status)
  return 'skip';
}

async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  headers['x-9r-cli-token'] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

/**
 * Ping satu koneksi via chat completions internal.
 * @param {object} conn - Provider connection
 * @param {string} baseUrl - Internal app URL
 * @returns {{ ok: boolean, status: number, latencyMs: number, error: string|null }}
 */
async function pingConnection(conn, baseUrl) {
  const model = conn.defaultModel || `${conn.provider}/*`;
  const headers = await getInternalHeaders();
  const start = Date.now();

  try {
    const res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1,
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    const latencyMs = Date.now() - start;
    const rawText = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

    if (!res.ok) {
      const detail =
        parsed?.error?.message || parsed?.error || rawText.slice(0, 200);
      return {
        ok: false,
        status: res.status,
        latencyMs,
        error: `HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    return { ok: true, status: res.status, latencyMs, error: null };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, error: e.message };
  }
}

/**
 * Jalankan daily check sekarang: ping semua koneksi dan update lifecycle.
 * Idempotent — skip jika sedang running (anti-race).
 */
export async function runDailyAccountCheckNow() {
  if (g.running) {
    console.log('[DailyCheck] skipped — already running');
    return;
  }
  g.running = true;

  const baseUrl = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
  const now = Date.now();

  console.log('[DailyCheck] starting daily account validation...');

  let all;
  try {
    all = await getProviderConnections();
  } catch (e) {
    console.error('[DailyCheck] failed to load connections:', e.message);
    g.running = false;
    return;
  }

  let checked = 0, activated = 0, deactivated = 0, paused = 0, skipped = 0;

  for (const conn of all) {
    try {
      // Skip: manual deactivation (user sengaja nonaktifkan)
      if (conn.deactivateReason === 'manual') {
        skipped++;
        continue;
      }

      // Skip: pause masih aktif di masa depan (biarkan pause-recovery yang handle)
      if (conn.pausedUntil && new Date(conn.pausedUntil).getTime() > now) {
        skipped++;
        continue;
      }

      const result = await pingConnection(conn, baseUrl);
      const action = classifyPingResult(result);

      console.log(
        `[DailyCheck] ${conn.provider}/${conn.id.slice(0, 8)}: ping=${result.ok ? 'ok' : 'fail'} status=${result.status} action=${action}`
      );

      if (action === 'activate') {
        await activate(conn.id);
        await updateProviderConnection(conn.id, {
          testStatus: 'active',
          lastTested: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        activated++;
      } else if (action === 'deactivate') {
        await deactivate(conn.id, 'daily-check');
        deactivated++;
      } else if (action === 'pause') {
        await pause(conn.id, PAUSE_DURATION_MS);
        paused++;
      } else {
        // skip — network/timeout error, jangan ubah status
        skipped++;
      }

      checked++;
    } catch (e) {
      console.warn(
        `[DailyCheck] ${conn.provider}/${conn.id.slice(0, 8)}: error: ${e.message}`
      );
      skipped++;
    }
  }

  console.log(
    `[DailyCheck] done. checked=${checked} activated=${activated} deactivated=${deactivated} paused=${paused} skipped=${skipped}`
  );

  g.running = false;
}

/**
 * Schedule daily account check ke midnight UTC berikutnya.
 * Rekursif: setelah jalan, schedule ulang ke midnight UTC berikutnya.
 * Singleton-safe via global.__dailyAccountCheck.
 */
export function startDailyAccountCheck() {
  // Sudah ada timer — jangan schedule duplikat
  if (g.timer) return;

  function scheduleNext() {
    const delay = msUntilMidnightUTC();
    const nextRun = new Date(Date.now() + delay).toISOString();
    console.log(`[DailyCheck] scheduled next run at ${nextRun} (in ${Math.round(delay / 60000)}m)`);

    g.timer = setTimeout(async () => {
      g.timer = null;
      try {
        await runDailyAccountCheckNow();
      } catch (e) {
        console.error('[DailyCheck] tick error:', e.message);
      }
      // Schedule ulang ke midnight berikutnya
      scheduleNext();
    }, delay);

    // Tidak block Node.js process exit
    if (g.timer?.unref) g.timer.unref();
  }

  scheduleNext();
}
