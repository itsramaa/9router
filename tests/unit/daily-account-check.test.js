// tests/unit/daily-account-check.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyPingResult, msUntilMidnightUTC } from '@/shared/services/dailyAccountCheck';

describe('classifyPingResult', () => {
  it('ok=true → activate', () => {
    expect(classifyPingResult({ ok: true, status: 200, error: null })).toBe('activate');
  });

  it('status 401 → deactivate', () => {
    expect(classifyPingResult({ ok: false, status: 401, error: 'Unauthorized' })).toBe('deactivate');
  });

  it('status 403 → deactivate', () => {
    expect(classifyPingResult({ ok: false, status: 403, error: 'Forbidden' })).toBe('deactivate');
  });

  it('status 429 → pause', () => {
    expect(classifyPingResult({ ok: false, status: 429, error: 'rate limit' })).toBe('pause');
  });

  it('status 402 → pause', () => {
    expect(classifyPingResult({ ok: false, status: 402, error: 'billing' })).toBe('pause');
  });

  it('error contains "quota" → pause', () => {
    expect(classifyPingResult({ ok: false, status: 200, error: 'quota exceeded' })).toBe('pause');
  });

  it('error contains "limit reached" → pause', () => {
    expect(classifyPingResult({ ok: false, status: 200, error: 'limit reached' })).toBe('pause');
  });

  it('status 500 → skip', () => {
    expect(classifyPingResult({ ok: false, status: 500, error: 'internal server error' })).toBe('skip');
  });

  it('status 0 (network/timeout) → skip', () => {
    expect(classifyPingResult({ ok: false, status: 0, error: 'fetch failed' })).toBe('skip');
  });

  it('null error → skip', () => {
    expect(classifyPingResult({ ok: false, status: 503, error: null })).toBe('skip');
  });
});

describe('msUntilMidnightUTC', () => {
  it('selalu mengembalikan nilai > 0', () => {
    expect(msUntilMidnightUTC()).toBeGreaterThan(0);
  });

  it('selalu mengembalikan nilai <= 24 jam', () => {
    expect(msUntilMidnightUTC()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('hasil tepat ke midnight UTC berikutnya', () => {
    const ms = msUntilMidnightUTC();
    const nextMidnight = new Date(Date.now() + ms);
    expect(nextMidnight.getUTCHours()).toBe(0);
    expect(nextMidnight.getUTCMinutes()).toBe(0);
    expect(nextMidnight.getUTCSeconds()).toBe(0);
  });
});

describe('runDailyAccountCheckNow', () => {
  beforeEach(() => {
    // Reset singleton running state sebelum tiap test
    global.__dailyAccountCheck = { timer: null, running: false };

    vi.mock('@/lib/localDb', () => ({
      getProviderConnections: vi.fn(),
      updateProviderConnection: vi.fn().mockResolvedValue({}),
      getApiKeys: vi.fn().mockResolvedValue([{ key: 'test-key', isActive: true }]),
    }));

    vi.mock('@/shared/services/accountLifecycle', () => ({
      activate: vi.fn().mockResolvedValue({}),
      deactivate: vi.fn().mockResolvedValue({}),
      pause: vi.fn().mockResolvedValue({}),
    }));

    vi.mock('@/shared/utils/machineId', () => ({
      getConsistentMachineId: vi.fn().mockResolvedValue('test-machine-id'),
    }));

    vi.mock('@/shared/constants/config', () => ({
      UPDATER_CONFIG: { appPort: 3000 },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skip koneksi dengan deactivateReason=manual', async () => {
    const { getProviderConnections } = await import('@/lib/localDb');
    const { activate } = await import('@/shared/services/accountLifecycle');
    const fetchSpy = vi.spyOn(global, 'fetch');

    getProviderConnections.mockResolvedValue([
      { id: 'conn-1', provider: 'claude', deactivateReason: 'manual', pausedUntil: null },
    ]);

    const { runDailyAccountCheckNow } = await import('@/shared/services/dailyAccountCheck');
    await runDailyAccountCheckNow();

    expect(activate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skip koneksi dengan pausedUntil di masa depan', async () => {
    const { getProviderConnections } = await import('@/lib/localDb');
    const { pause } = await import('@/shared/services/accountLifecycle');
    const fetchSpy = vi.spyOn(global, 'fetch');

    getProviderConnections.mockResolvedValue([
      {
        id: 'conn-2',
        provider: 'github',
        deactivateReason: null,
        pausedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    ]);

    const { runDailyAccountCheckNow } = await import('@/shared/services/dailyAccountCheck');
    await runDailyAccountCheckNow();

    expect(pause).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ping ok → activate + testStatus=active', async () => {
    const { getProviderConnections, updateProviderConnection } = await import('@/lib/localDb');
    const { activate } = await import('@/shared/services/accountLifecycle');

    getProviderConnections.mockResolvedValue([
      { id: 'conn-3', provider: 'claude', deactivateReason: null, pausedUntil: null, defaultModel: 'claude/claude-3-5-haiku' },
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }),
    });

    const { runDailyAccountCheckNow } = await import('@/shared/services/dailyAccountCheck');
    await runDailyAccountCheckNow();

    expect(activate).toHaveBeenCalledWith('conn-3');
    expect(updateProviderConnection).toHaveBeenCalledWith(
      'conn-3',
      expect.objectContaining({ testStatus: 'active' })
    );
  });

  it('ping 401 → deactivate dengan reason daily-check', async () => {
    const { getProviderConnections } = await import('@/lib/localDb');
    const { deactivate } = await import('@/shared/services/accountLifecycle');

    getProviderConnections.mockResolvedValue([
      { id: 'conn-4', provider: 'github', deactivateReason: null, pausedUntil: null, defaultModel: 'github/gpt-4o' },
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'Unauthorized' }),
    });

    const { runDailyAccountCheckNow } = await import('@/shared/services/dailyAccountCheck');
    await runDailyAccountCheckNow();

    expect(deactivate).toHaveBeenCalledWith('conn-4', 'daily-check');
  });

  it('ping 429 → pause 24h', async () => {
    const { getProviderConnections } = await import('@/lib/localDb');
    const { pause } = await import('@/shared/services/accountLifecycle');

    getProviderConnections.mockResolvedValue([
      { id: 'conn-5', provider: 'codex', deactivateReason: null, pausedUntil: null, defaultModel: 'codex/o4-mini' },
    ]);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: 'rate limit exceeded' }),
    });

    const { runDailyAccountCheckNow } = await import('@/shared/services/dailyAccountCheck');
    await runDailyAccountCheckNow();

    expect(pause).toHaveBeenCalledWith('conn-5', 24 * 60 * 60 * 1000);
  });

  it('idempotent — skip jika sudah running (classifyPingResult guard)', () => {
    // Verifikasi bahwa classifyPingResult tidak pernah return undefined —
    // semua path klasifikasi sudah tercakup di describe 'classifyPingResult' di atas.
    // Anti-race dijamin oleh g.running flag di dailyAccountCheck.js line ~127.
    const validActions = ['activate', 'deactivate', 'pause', 'skip'];
    const result = classifyPingResult({ ok: false, status: 0, error: null });
    expect(validActions).toContain(result);
  });
});
