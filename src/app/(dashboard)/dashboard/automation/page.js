'use client';
import { useState, useCallback, useEffect } from 'react';

import ConnectionBar from './components/ConnectionBar';

import AccountsPanel from './components/AccountsPanel';

import ConfigPanel from './components/ConfigPanel';

import ControlBar from './components/ControlBar';

import SlotDetail from './components/SlotDetail';

import AccountProgress from './components/AccountProgress';

import LiveLog from './components/LiveLog';

import ResultsPanel from './components/ResultsPanel';

import InteractModal from './components/InteractModal';

import ServerManager from './components/ServerManager';

import { useAutomationWS } from './hooks/useAutomationWS';

const DEFAULT_SERVER_URL = 'http://localhost:8765';

const DEFAULT_CONFIG = {
  providers: ['kiro', 'openrouter'],

  concurrent: 1,

  proxy: '',

  displayMode: 'headless',
};

const MAX_LOG = 500;

const SESSION_KEY = 'automation_session_v1';

function loadSession() {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(SESSION_KEY);

    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getWsUrl(serverUrl) {
  try {
    return serverUrl.replace(/^http/, 'ws') + '/ws';
  } catch {
    return 'ws://localhost:8765/ws';
  }
}

function ts() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export default function AutomationPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);

  // wsEnabled is driven by server state — true when running, false when stopped

  const [wsEnabled, setWsEnabled] = useState(false);

  const [wsStatus, setWsStatus] = useState('disconnected');

  const [accounts, setAccounts] = useState([]);

  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const [runState, setRunState] = useState('idle');

  const [slots, setSlots] = useState([]);

  const [frames, setFrames] = useState({});

  const [accountProgress, setAccountProgress] = useState({});

  const [pendingInteract, setPendingInteract] = useState({});

  const [interactOpen, setInteractOpen] = useState(null);

  const [logEntries, setLogEntries] = useState([]);

  const [results, setResults] = useState([]);

  const [failedAccounts, setFailedAccounts] = useState([]); // Track failed accounts for batch retry

  const [retryMode, setRetryMode] = useState(false); // Track if we're in retry mode

  // Persist session state to localStorage on change (debounced)

  useEffect(() => {
    const tid = setTimeout(() => {
      try {
        localStorage.setItem(
          SESSION_KEY,

          JSON.stringify({
            config,

            runState,

            slots,

            accountProgress,

            logEntries: logEntries.slice(-200), // keep last 200 to stay within quota

            results,
          })
        );
      } catch {
        /* quota exceeded */
      }
    }, 800);

    return () => clearTimeout(tid);
  }, [config, runState, slots, accountProgress, logEntries, results]);

  // Restore persisted session after hydration (useEffect = client-only, avoids SSR mismatch)

  useEffect(() => {
    const s = loadSession();

    if (!s || !Object.keys(s).length) return;

    // Defer setState calls out of the synchronous effect body to avoid

    // "setState synchronously within an effect" React compiler warning.

    setTimeout(() => {
      if (s.config) setConfig((c) => ({ ...c, ...s.config }));

      const restoredRunState = (() => {
        const r = s.runState;

        return r === 'running' || r === 'stopping' ? 'done' : r || 'idle';
      })();

      if (s.runState) setRunState(restoredRunState);

      // Only restore live slot/progress state if harvest was actually mid-run.

      // A finished/idle session means the data is stale — don't show it on reload.

      const wasActive = restoredRunState === 'running';

      if (wasActive && s.slots?.length) setSlots(s.slots);

      if (
        wasActive &&
        s.accountProgress &&
        Object.keys(s.accountProgress).length
      )
        setAccountProgress(s.accountProgress);

      if (s.logEntries?.length) setLogEntries(s.logEntries);

      if (s.results?.length) setResults(s.results);
    }, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // accounts state is fed by AccountsPanel's onChange (reads from DB directly)

  const pushLog = useCallback((entry) => {
    setLogEntries((prev) => {
      const next = [...prev, entry];

      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }, []);

  const updateAccountProgress = useCallback((email, slotIdx, patch) => {
    if (!email) return;

    setAccountProgress((prev) => {
      const existing = prev[email] ?? {
        email,

        slot: slotIdx,

        status: 'pending',

        steps: [],

        currentMessage: '',
      };

      return { ...prev, [email]: { ...existing, ...patch } };
    });
  }, []);

  const handleMessage = useCallback(
    (msg) => {
      // ── System messages ───────────────────────────────────────────────

      if (msg.type === 'connected') {
        // WS reconnected — sync runState if server says harvest is not running

        if (!msg.running)
          setRunState((prev) => (prev === 'running' ? 'idle' : prev));

        return;
      }

      if (msg.type === 'started') {
        setRunState('running');

        return;
      }

      if (msg.type === 'done_stream') {
        // Subprocess stdout closed — harvest finished (naturally or killed)

        setRunState((prev) => (prev === 'running' ? 'done' : prev));

        return;
      }

      if (msg.type === 'stopped') {
        setRunState('idle');

        setSlots([]);

        setFrames({});

        return;
      }

      if (msg.type === 'reset') {
        setSlots([]);

        setFrames({});

        setResults([]);

        setAccountProgress({});

        setPendingInteract({});

        setFailedAccounts([]);

        setRunState('idle');

        return;
      }

      // ─────────────────────────────────────────────────────────────────

      if (msg.type === 'frame' && msg.slot != null && msg.base64) {
        setFrames((prev) => ({ ...prev, [msg.slot]: msg.base64 }));

        // Ensure slot card appears in the grid even before a progress message arrives

        setSlots((prev) => {
          if (prev.some((s) => s.index === msg.slot)) return prev;

          return [
            ...prev,

            {
              index: msg.slot,

              email: '',

              provider: '',

              message: '',

              status: 'running',
            },
          ];
        });

        return;
      }

      pushLog({ ...msg, ts: ts() });

      if (msg.type === 'interact_required' && msg.slot != null) {
        setPendingInteract((prev) => ({
          ...prev,

          [msg.slot]: {
            index: msg.slot,

            email: msg.email,

            provider: msg.provider,

            reason: msg.reason,
          },
        }));

        setSlots((prev) =>
          prev.map((s) =>
            s.index === msg.slot ? { ...s, status: 'interact' } : s
          )
        );

        updateAccountProgress(msg.email, msg.slot, {
          status: 'interact',

          currentMessage: msg.reason,
        });

        return;
      }

      if (msg.type === 'interact_done' && msg.slot != null) {
        setPendingInteract((prev) => {
          const n = { ...prev };

          delete n[msg.slot];

          return n;
        });

        setSlots((prev) =>
          prev.map((s) =>
            s.index === msg.slot ? { ...s, status: 'running' } : s
          )
        );

        return;
      }

      if (msg.slot != null) {
        const newStatus =
          msg.type === 'error'
            ? 'error'
            : msg.type === 'result'
              ? 'done'
              : 'running';

        setSlots((prev) => {
          const idx = prev.findIndex((s) => s.index === msg.slot);

          const updated = {
            index: msg.slot,

            email: msg.email ?? prev[idx]?.email ?? '',

            provider: msg.provider ?? prev[idx]?.provider ?? '',

            message: msg.message ?? msg.error ?? '',

            status: newStatus,
          };

          if (idx === -1) return [...prev, updated];

          const next = [...prev];

          next[idx] = updated;

          return next;
        });

        const email = msg.email;

        // Track failed accounts for batch retry
        if (newStatus === 'error' && email) {
          setFailedAccounts((prev) => {
            const exists = prev.find((f) => f.email === email);
            if (exists) return prev;
            return [
              ...prev,
              { email, slot: msg.slot, error: msg.error || msg.message },
            ];
          });
        }

        if (email && msg.provider) {
          setAccountProgress((prev) => {
            const acc = prev[email] ?? {
              email,

              slot: msg.slot,

              status: 'running',

              steps: [],

              currentMessage: '',
            };

            const stepIdx = acc.steps.findIndex(
              (s) => s.provider === msg.provider
            );

            const stepStatus =
              msg.type === 'error'
                ? 'error'
                : msg.type === 'api_key'
                  ? 'success'
                  : msg.type === 'result'
                    ? 'success'
                    : 'running';

            let steps = [...acc.steps];

            if (stepIdx === -1)
              steps = [
                ...steps,

                { provider: msg.provider, status: stepStatus },
              ];
            else {
              steps = [...steps];

              steps[stepIdx] = { ...steps[stepIdx], status: stepStatus };
            }

            const accStatus =
              msg.type === 'result'
                ? 'done'
                : msg.type === 'error' && msg.provider === '_session'
                  ? 'error'
                  : 'running';

            return {
              ...prev,

              [email]: {
                ...acc,

                slot: msg.slot,

                steps,

                status: accStatus,

                currentMessage: msg.message ?? msg.error ?? '',
              },
            };
          });
        }
      }

      // api_key events are logged above; full key injection happens in the 'result' handler below.

      if (msg.type === 'result' && msg.api_keys) {
        const email = msg.email ?? '';

        const newKeys = Object.entries(msg.api_keys).map(([provider, key]) => ({
          provider,

          email,

          key: typeof key === 'string' ? key : String(key),
        }));

        if (newKeys.length > 0) {
          setResults((prev) => {
            const existing = new Set(
              prev.map((r) => `${r.provider}:${r.email}`)
            );

            return [
              ...prev,

              ...newKeys.filter(
                (k) => !existing.has(`${k.provider}:${k.email}`)
              ),
            ];
          });

          for (const { provider, key, email: kEmail } of newKeys) {
            fetch('/api/automation/inject-key', {
              method: 'POST',

              headers: { 'Content-Type': 'application/json' },

              body: JSON.stringify({
                provider,

                key,

                email: kEmail,

                name: kEmail,
              }),
            }).catch(() => {});
          }
        }

        setRunState((prev) => (prev === 'running' ? 'done' : prev));
      }

      if (msg.type === 'progress' && msg.step === 'done') {
        setRunState((prev) => (prev === 'running' ? 'done' : prev));
      }
    },

    [pushLog, updateAccountProgress]
  );

  const handleStatusChange = useCallback((s) => setWsStatus(s), []);

  useAutomationWS(
    getWsUrl(serverUrl),

    handleMessage,

    handleStatusChange,

    wsEnabled
  );

  // ServerManager callbacks — drive wsEnabled from server state

  const handleServerReady = useCallback((port) => {
    setServerUrl(`http://localhost:${port}`);

    setWsEnabled(true);
  }, []);

  const handleServerStateChange = useCallback((serverStatus) => {
    if (serverStatus === 'stopped' || serverStatus === 'error') {
      setWsEnabled(false);
    }
  }, []);

  async function handleInteractAction(slotIdx, action) {
    await fetch('/api/automation/api/interact', {
      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ slot: slotIdx, action }),
    });
  }

  async function handleRetrySlot(slotIdx) {
    // Optimistic: mark slot as running immediately so Retry button disappears

    setSlots((prev) =>
      prev.map((s) =>
        s.index === slotIdx
          ? { ...s, status: 'running', message: 'Retrying...' }
          : s
      )
    );

    // Timeout fallback: if no WS status update arrives within 15s the server is

    // likely stuck — revert to error so the Retry button reappears.

    const fallbackTimer = setTimeout(() => {
      setSlots((prev) =>
        prev.map((s) =>
          s.index === slotIdx && s.message === 'Retrying...'
            ? {
                ...s,
                status: 'error',
                message: 'Retry timed out — no response from server',
              }
            : s
        )
      );
    }, 15000);

    try {
      await fetch('/api/automation/api/retry', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ slot: slotIdx }),
      });
      clearTimeout(fallbackTimer);
    } catch {
      clearTimeout(fallbackTimer);

      // Revert on network error

      setSlots((prev) =>
        prev.map((s) =>
          s.index === slotIdx
            ? { ...s, status: 'error', message: 'Retry failed' }
            : s
        )
      );
    }
  }

  async function handleRetryFailed() {
    if (failedAccounts.length === 0) {
      pushLog({
        type: 'warn',
        ts: ts(),
        message: 'No failed accounts to retry.',
      });
      return;
    }

    const emails = failedAccounts.map((f) => f.email);

    pushLog({
      type: 'info',
      ts: ts(),
      message: `Retrying ${emails.length} failed account(s)...`,
    });

    // Clear failed list and start retry
    setFailedAccounts([]);
    setRetryMode(true);
    setRunState('running');

    try {
      const res = await fetch('/api/automation/api/bulk-harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
          providers: config.providers,
          concurrent: config.concurrent,
          proxy: config.proxy || undefined,
          display_mode: config.displayMode,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      pushLog({ type: 'success', ts: ts(), message: 'Retry batch started' });
    } catch (e) {
      pushLog({
        type: 'error',
        ts: ts(),
        message: `Retry failed: ${e.message}`,
      });
      setRunState('idle');
    }
  }

  async function handleBulkHarvest(emails) {
    if (!emails || emails.length === 0) {
      pushLog({
        type: 'error',
        ts: ts(),
        message: 'No accounts selected for bulk harvest.',
      });

      return;
    }

    // Clear failed accounts list for new run
    setFailedAccounts([]);

    pushLog({
      type: 'info',
      ts: ts(),
      message: `Starting bulk harvest for ${emails.length} account(s)...`,
    });

    try {
      const res = await fetch('/api/automation/api/bulk-harvest', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({
          emails,

          providers: config.providers,

          concurrent: config.concurrent,

          proxy: config.proxy || undefined,

          display_mode: config.displayMode,
        }),
      });

      if (!res.ok) {
        const err = await res.json();

        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      pushLog({
        type: 'success',
        ts: ts(),
        message: `Bulk harvest started for ${emails.length} account(s) (PID: ${data.pid})`,
      });
    } catch (e) {
      pushLog({
        type: 'error',
        ts: ts(),
        message: `Bulk harvest failed: ${e.message}`,
      });
    }
  }

  async function handleStart() {
    if (accounts.length === 0) {
      pushLog({ type: 'error', ts: ts(), message: 'No accounts configured.' });

      return;
    }

    if (config.providers.length === 0) {
      pushLog({ type: 'error', ts: ts(), message: 'No providers selected.' });

      return;
    }

    setRunState('running');

    setFailedAccounts([]); // Clear failed accounts from previous run

    // Pre-populate placeholder slots so the browser grid appears immediately

    const placeholders = Array.from({ length: config.concurrent }, (_, i) => ({
      index: i + 1,

      email: '',

      provider: '',

      message: 'Starting...',

      status: 'idle',
    }));

    setSlots(placeholders);

    setFrames({});

    setAccountProgress({});

    setPendingInteract({});

    try {
      const res = await fetch('/api/automation/api/start', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({
          providers: config.providers,

          concurrent: config.concurrent,

          proxy: config.proxy || undefined,

          display_mode: config.displayMode,
        }),
      });

      if (!res.ok) {
        const err = await res.text();

        pushLog({ type: 'error', ts: ts(), message: `Start failed: ${err}` });

        setRunState('idle');

        setSlots([]);
      }
    } catch (e) {
      pushLog({
        type: 'error',

        ts: ts(),

        message: `Start failed: ${e.message}`,
      });

      setRunState('idle');

      setSlots([]);
    }
  }

  async function handleSimulate() {
    if (accounts.length === 0) {
      pushLog({ type: 'error', ts: ts(), message: 'No accounts configured.' });

      return;
    }

    if (config.providers.length === 0) {
      pushLog({ type: 'error', ts: ts(), message: 'No providers selected.' });

      return;
    }

    setRunState('running');

    const placeholders = Array.from({ length: config.concurrent }, (_, i) => ({
      index: i + 1,

      email: '',

      provider: '',

      message: 'Simulating...',

      status: 'idle',
    }));

    setSlots(placeholders);

    setFrames({});

    setAccountProgress({});

    setPendingInteract({});

    try {
      const res = await fetch('/api/automation/api/simulate', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({
          providers: config.providers,

          concurrent: config.concurrent,

          fail_rate: 0.1,

          interact_rate: 0.1,

          delay: 0.4,
        }),
      });

      if (!res.ok) {
        const err = await res.text();

        pushLog({
          type: 'error',

          ts: ts(),

          message: `Simulate failed: ${err}`,
        });

        setRunState('idle');

        setSlots([]);
      }
    } catch (e) {
      pushLog({
        type: 'error',

        ts: ts(),

        message: `Simulate failed: ${e.message}`,
      });

      setRunState('idle');

      setSlots([]);
    }
  }

  async function handleStop() {
    setRunState('stopping');

    try {
      await fetch('/api/automation/api/stop', { method: 'POST' });
    } catch {
      /* ignore */
    }

    setRunState('idle');
  }

  async function handleReset() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {}

    setSlots([]);

    setFrames({});

    setLogEntries([]);

    setResults([]);

    setAccountProgress({});

    setPendingInteract({});

    setFailedAccounts([]);

    setRunState('idle');

    try {
      await fetch('/api/automation/api/reset', { method: 'POST' });
    } catch {
      /* ignore */
    }
  }

  const accountList = Object.values(accountProgress);

  const interactSlot =
    interactOpen != null ? pendingInteract[interactOpen] : null;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}

      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[20px]">
            smart_toy
          </span>
        </div>

        <div>
          <h1 className="text-lg font-semibold text-text-main">Automation</h1>

          <p className="text-xs text-text-muted">
            Bulk API key harvester — bulk-accounts server
          </p>
        </div>

        {Object.keys(pendingInteract).length > 0 && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <span className="material-symbols-outlined text-[16px] text-blue-500 animate-pulse">
              touch_app
            </span>

            <span className="text-xs font-semibold text-blue-500">
              {Object.keys(pendingInteract).length} slot
              {Object.keys(pendingInteract).length > 1 ? 's' : ''} waiting
            </span>
          </div>
        )}
      </div>

      {/* Server Manager — spawn Python process, drives WS enable/disable */}

      <ServerManager
        onServerReady={handleServerReady}
        onServerStateChange={handleServerStateChange}
      />

      {/* WS status bar — informational only, no manual toggle */}

      <ConnectionBar status={wsStatus} serverUrl={serverUrl} />

      {/* Harvest control */}

      <ControlBar
        runState={runState}
        onStart={handleStart}
        onSimulate={handleSimulate}
        onStop={handleStop}
        onReset={handleReset}
        disabled={wsStatus !== 'connected'}
      />

      {/* Config + Accounts */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccountsPanel
          onChange={setAccounts}
          onBulkHarvest={handleBulkHarvest}
        />

        <ConfigPanel config={config} onChange={setConfig} />
      </div>

      {/* Live slot grid */}

      {slots.length > 0 && (
        <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <span className="material-symbols-outlined text-[18px] text-primary">
              view_module
            </span>

            <h2 className="text-sm font-semibold text-text-main">
              Browser Slots
            </h2>

            <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {slots.length}
            </span>

            {accountList.length > 0 && (
              <>
                <span className="text-text-muted text-[11px]">•</span>

                <span className="text-[11px] text-text-muted font-mono">
                  Success:{' '}
                  {accountList.filter((a) => a.status === 'done').length} /
                  Failed:{' '}
                  {accountList.filter((a) => a.status === 'error').length} /
                  Total: {accountList.length}
                </span>
              </>
            )}
          </div>

          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {slots.map((slot) => (
              <SlotDetail
                key={slot.index}
                slot={slot}
                frame={frames[slot.index] ?? null}
                slots={slots}
                frames={frames}
                slotIndex={slots.findIndex((s) => s.index === slot.index)}
                logEntries={logEntries}
                onInteract={(idx) => setInteractOpen(idx)}
                onRetry={null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Global Retry Button - appears after run finishes with failures */}
      {runState === 'done' && failedAccounts.length > 0 && (
        <div className="mx-3 mb-3 rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
          <div className="px-4 py-3 border-b border-red-500/20 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-red-400">
              error
            </span>
            <span className="text-sm font-semibold text-red-400">
              {failedAccounts.length} Account
              {failedAccounts.length !== 1 ? 's' : ''} Failed
            </span>
          </div>

          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              {failedAccounts.slice(0, 5).map((f) => (
                <div
                  key={f.email}
                  className="text-xs font-mono px-2 py-1 rounded-lg bg-red-500/10 text-red-300 border border-red-500/20"
                >
                  {f.email}
                </div>
              ))}
              {failedAccounts.length > 5 && (
                <div className="text-xs font-mono px-2 py-1 rounded-lg bg-red-500/10 text-red-300/60">
                  +{failedAccounts.length - 5} more
                </div>
              )}
            </div>

            <button
              onClick={async () => {
                const emails = failedAccounts.map((f) => f.email);
                setRetryMode(true);
                await handleBulkHarvest(emails);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 font-semibold transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">
                restart_alt
              </span>
              Retry All Failed Accounts
            </button>
          </div>
        </div>
      )}

      {accountList.length > 0 && <AccountProgress accounts={accountList} />}

      <LiveLog entries={logEntries} onClear={() => setLogEntries([])} />

      <ResultsPanel results={results} />

      {interactOpen != null && interactSlot && (
        <InteractModal
          slot={interactSlot}
          frame={frames[interactOpen] ?? null}
          onAction={handleInteractAction}
          onClose={() => setInteractOpen(null)}
        />
      )}
    </div>
  );
}
