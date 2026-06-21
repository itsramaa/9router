'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/shared/utils/cn';

const STATUS_CFG = {
  stopped: {
    dot: 'bg-surface-2 border border-border-subtle',
    label: 'Stopped',
    color: 'text-text-muted',
    border: 'border-border-subtle',
  },
  starting: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Starting',
    color: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-400/30',
  },
  running: {
    dot: 'bg-green-500 animate-pulse',
    label: 'Running',
    color: 'text-green-600 dark:text-green-400',
    border: 'border-green-500/30',
  },
  stopping: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Stopping',
    color: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-400/30',
  },
  error: {
    dot: 'bg-red-500',
    label: 'Error',
    color: 'text-red-500',
    border: 'border-red-500/30',
  },
};
const SETUP_CFG = {
  idle: {
    dot: 'bg-surface-2 border border-border-subtle',
    label: 'Not installed',
    color: 'text-text-muted',
  },
  running: {
    dot: 'bg-amber-400 animate-pulse',
    label: 'Installing...',
    color: 'text-amber-600 dark:text-amber-400',
  },
  done: {
    dot: 'bg-green-500',
    label: 'Installed',
    color: 'text-green-600 dark:text-green-400',
  },
  error: { dot: 'bg-red-500', label: 'Failed', color: 'text-red-500' },
};
const LOG_COLORS = {
  stdout: 'text-text-main',
  stderr: 'text-amber-500 dark:text-amber-400',
  system: 'text-blue-500 dark:text-blue-400',
};

const LS_KEY = 'automation_server_cfg';
function loadCfg() {
  try {
    const r = localStorage.getItem(LS_KEY);
    if (r) return JSON.parse(r);
  } catch {}
  return { pythonPath: '', port: '' };
}
function saveCfg(c) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(c));
  } catch {}
}

function formatUptime(ms) {
  if (!ms) return '0s';
  const s = Math.floor(ms / 1000),
    m = Math.floor(s / 60),
    h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function ServerManager({ onServerReady, onServerStateChange }) {
  const [cfg, setCfg] = useState({ pythonPath: '', port: '' });
  const [envPort, setEnvPort] = useState(8765);
  const [status, setStatus] = useState('stopped');
  const [pid, setPid] = useState(null);
  const [now, setNow] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [setup, setSetup] = useState({ deps: 'idle', camoufox: 'idle' });
  const [hasVenv, setHasVenv] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const logContainerRef = useRef(null);
  const logBottomRef = useRef(null);
  // Track whether user has manually scrolled up — ref avoids re-renders
  const autoScrollRef = useRef(true);
  const esRef = useRef(null);
  const pollRef = useRef(null);
  const prevStatus = useRef('stopped');

  useEffect(() => {
    // Defer to avoid synchronous setState-in-effect warning
    const tid = setTimeout(() => setCfg(loadCfg()), 0);
    return () => clearTimeout(tid);
  }, []);

  // Update 'now' every second from the interval — never calls setState synchronously
  useEffect(() => {
    if (status !== 'running' || !startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  // Smart auto-scroll: only scroll if user hasn't scrolled up
  useEffect(() => {
    if (!logsOpen || !autoScrollRef.current) return;
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, logsOpen]);

  function handleLogScroll(e) {
    const el = e.currentTarget;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If user scrolled more than 60px from bottom → disable auto-scroll
    autoScrollRef.current = distFromBottom < 60;
  }

  const connectLogStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const es = new EventSource('/api/automation/server/logs');
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        setLogs((prev) => {
          const n = [...prev, entry];
          return n.length > 300 ? n.slice(-300) : n;
        });
      } catch {}
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/server');
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setPid(data.pid);
      setStartedAt(data.startedAt);
      if (data.setup) setSetup(data.setup);
      if (data.envPort) setEnvPort(data.envPort);
      if (data.hasVenv !== undefined) setHasVenv(data.hasVenv);
      if (data.status !== prevStatus.current) {
        prevStatus.current = data.status;
        onServerStateChange?.(data.status);
        if (data.status === 'running' && onServerReady) {
          onServerReady(data.port || data.envPort || 8765);
        }
      }
    } catch {}
  }, [onServerReady, onServerStateChange]);

  // Connect SSE log stream once on mount — never reconnect on re-renders
  useEffect(() => {
    connectLogStream();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const initPoll = setTimeout(() => pollStatus(), 0);
    fetch('/api/automation/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check' }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.setup) setSetup(d.setup);
      })
      .catch(() => {});
    // Adaptive polling: fast during transitions (1s), slow when stable (10s)
    function schedulePoll() {
      const transitioning = ['starting', 'stopping'].includes(
        prevStatus.current
      );
      pollRef.current = setTimeout(
        async () => {
          await pollStatus();
          schedulePoll();
        },
        transitioning ? 1000 : 10000
      );
    }
    schedulePoll();
    return () => {
      clearTimeout(initPoll);
      clearTimeout(pollRef.current);
    };
  }, [pollStatus]);

  function handleCfgChange(key, val) {
    const next = { ...cfg, [key]: val };
    setCfg(next);
    saveCfg(next);
  }

  async function runSetupAction(action) {
    setSetupBusy(true);
    setLogsOpen(true);
    autoScrollRef.current = true;
    try {
      await fetch('/api/automation/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          pythonPath: cfg.pythonPath || undefined,
        }),
      });
      if (action === 'create-venv') await pollStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setSetupBusy(false);
    }
  }

  const effectivePort = cfg.port || String(envPort || 8765);

  async function handleStart() {
    setError('');
    setBusy(true);
    setLogs([]);
    autoScrollRef.current = true;
    try {
      const res = await fetch('/api/automation/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          pythonPath: cfg.pythonPath || undefined,
          port: Number(effectivePort) || undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error || 'Failed to start');
      else {
        connectLogStream();
        setLogsOpen(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await fetch('/api/automation/server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    } finally {
      setBusy(false);
    }
  }

  const st = STATUS_CFG[status] ?? STATUS_CFG.stopped;
  const isRunning = status === 'running';
  const isBusy = status === 'starting' || status === 'stopping' || busy;
  const canStart = !isBusy && (status === 'stopped' || status === 'error');
  const canStop = !busy && (isRunning || status === 'starting');
  const needsSetup = setup.deps !== 'done' || setup.camoufox !== 'done';
  // 'now' is updated by setInterval — use it to compute uptime without calling Date.now() in render
  const uptime = isRunning && startedAt && now ? now - startedAt : null;

  return (
    <div
      className={cn(
        'rounded-[14px] border bg-surface shadow-[var(--shadow-soft)] overflow-hidden transition-colors',
        st.border
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className={cn(
            'flex items-center justify-center size-8 rounded-lg shrink-0',
            isRunning ? 'bg-green-500/10' : 'bg-surface-2'
          )}
        >
          <span
            className={cn(
              'material-symbols-outlined text-[18px]',
              isRunning ? 'text-green-500' : 'text-text-muted'
            )}
          >
            terminal
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-main">
              bulk-accounts Server
            </span>
            <div className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full shrink-0', st.dot)} />
              <span className={cn('text-xs font-semibold', st.color)}>
                {st.label}
              </span>
            </div>
            {isRunning && pid && (
              <span className="text-[10px] text-text-muted font-mono">
                pid:{pid}
              </span>
            )}
            {isRunning && uptime != null && (
              <span className="text-[10px] text-green-600/80 dark:text-green-400/70">
                ↑ {formatUptime(uptime)}
              </span>
            )}
            {needsSetup && !isRunning && (
              <button
                onClick={() => setSetupOpen(true)}
                className="text-[10px] text-amber-500 flex items-center gap-0.5 hover:underline cursor-pointer"
              >
                <span className="material-symbols-outlined text-[11px]">
                  warning
                </span>
                Setup required
              </button>
            )}
          </div>
          <p className="text-[11px] text-text-muted truncate">
            {isRunning
              ? `Port :${effectivePort} · WS connected · Keys auto-injected to DB`
              : hasVenv
                ? 'Python harvester — using ./bulk-accounts/venv/'
                : 'Python harvester — bundled at ./bulk-accounts/'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(needsSetup || setupOpen) && (
            <button
              onClick={() => setSetupOpen((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
                setupOpen
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-amber-400/40 text-amber-600 dark:text-amber-400 hover:bg-amber-400/10'
              )}
            >
              <span className="material-symbols-outlined text-[14px]">
                build
              </span>
              Setup
            </button>
          )}
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer',
              logsOpen
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border-subtle text-text-muted hover:bg-surface-2 hover:text-text-main'
            )}
          >
            <span className="material-symbols-outlined text-[14px]">
              article
            </span>
            Logs
            {logs.length > 0 && (
              <span className="px-1 rounded-full bg-surface-2 text-text-muted text-[10px] font-mono">
                {logs.length}
              </span>
            )}
          </button>
          {canStop && (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-xs font-semibold hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">
                stop
              </span>
              Stop
            </button>
          )}
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30 cursor-pointer shadow-[var(--shadow-warm)]"
          >
            <span
              className={cn(
                'material-symbols-outlined text-[14px]',
                isBusy ? 'animate-spin' : ''
              )}
            >
              {isBusy ? 'sync' : 'play_arrow'}
            </span>
            {status === 'starting'
              ? 'Starting...'
              : status === 'stopping'
                ? 'Stopping...'
                : 'Start'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 flex items-start gap-2">
          <span className="material-symbols-outlined text-[14px] text-red-500 shrink-0 mt-px">
            error
          </span>
          <p className="text-xs text-red-500 flex-1">{error}</p>
          <button
            onClick={() => setError('')}
            className="text-red-400 hover:text-red-500 cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Setup panel */}
      {setupOpen && (
        <div className="border-t border-border-subtle bg-surface-2/30 px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Python Environment Setup
            </p>
            <button
              onClick={() => runSetupAction('install-all')}
              disabled={
                setupBusy ||
                (setup.deps === 'done' && setup.camoufox === 'done')
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <span
                className={cn(
                  'material-symbols-outlined text-[14px]',
                  setupBusy ? 'animate-spin' : ''
                )}
              >
                {setupBusy ? 'sync' : 'download'}
              </span>
              {setup.deps === 'done' && setup.camoufox === 'done'
                ? 'All Installed ✓'
                : 'Install All'}
            </button>
          </div>
          <div className="space-y-2">
            {/* venv */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-subtle bg-surface">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      hasVenv
                        ? 'bg-green-500'
                        : 'bg-surface-2 border border-border-subtle'
                    )}
                  />
                  <span className="text-xs font-semibold text-text-main">
                    Virtual Environment (venv)
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      hasVenv
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-text-muted'
                    )}
                  >
                    {hasVenv
                      ? 'Found at ./venv/'
                      : 'Not found — using system Python'}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 ml-4">
                  {hasVenv
                    ? 'Deps install into venv automatically'
                    : 'Optional — isolated ./bulk-accounts/venv/'}
                </p>
              </div>
              <button
                onClick={() => runSetupAction('create-venv')}
                disabled={setupBusy || hasVenv}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0',
                  hasVenv
                    ? 'border border-green-500/30 text-green-600 dark:text-green-400 cursor-default'
                    : 'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40'
                )}
              >
                {hasVenv ? 'Active ✓' : 'Create venv'}
              </button>
            </div>
            {/* deps */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-subtle bg-surface">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      SETUP_CFG[setup.deps]?.dot ?? SETUP_CFG.idle.dot
                    )}
                  />
                  <span className="text-xs font-semibold text-text-main">
                    Python Dependencies
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      SETUP_CFG[setup.deps]?.color ?? SETUP_CFG.idle.color
                    )}
                  >
                    {SETUP_CFG[setup.deps]?.label}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 ml-4">
                  pip install -r requirements-harvest.txt
                </p>
                {hasVenv && setup.deps === 'idle' && (
                  <p className="text-[10px] text-amber-500 mt-0.5 ml-4 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[11px]">
                      info
                    </span>
                    venv detected — deps may be in system Python. Click Install
                    to install into venv.
                  </p>
                )}
              </div>
              <button
                onClick={() => runSetupAction('install-deps')}
                disabled={setupBusy || setup.deps === 'running'}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0',
                  setup.deps === 'done'
                    ? 'border border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10'
                    : 'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40'
                )}
              >
                {setup.deps === 'done'
                  ? 'Re-install'
                  : setup.deps === 'running'
                    ? 'Installing...'
                    : 'Install'}
              </button>
            </div>
            {/* camoufox */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-subtle bg-surface">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      SETUP_CFG[setup.camoufox]?.dot ?? SETUP_CFG.idle.dot
                    )}
                  />
                  <span className="text-xs font-semibold text-text-main">
                    Camoufox Browser
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      SETUP_CFG[setup.camoufox]?.color ?? SETUP_CFG.idle.color
                    )}
                  >
                    {SETUP_CFG[setup.camoufox]?.label}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mt-0.5 ml-4">
                  python -m camoufox fetch (~100MB)
                </p>
              </div>
              <button
                onClick={() => runSetupAction('install-camoufox')}
                disabled={
                  setupBusy ||
                  setup.camoufox === 'running' ||
                  setup.deps !== 'done'
                }
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0',
                  setup.camoufox === 'done'
                    ? 'border border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10'
                    : 'bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40'
                )}
              >
                {setup.camoufox === 'done'
                  ? 'Re-fetch'
                  : setup.camoufox === 'running'
                    ? 'Downloading...'
                    : 'Download'}
              </button>
            </div>
          </div>
          <details className="group">
            <summary className="text-[10px] text-text-muted cursor-pointer hover:text-text-main list-none flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] group-open:rotate-90 transition-transform">
                chevron_right
              </span>
              Advanced — Python executable override
            </summary>
            <div className="mt-2 pl-4">
              <input
                type="text"
                value={cfg.pythonPath}
                onChange={(e) => handleCfgChange('pythonPath', e.target.value)}
                placeholder="python  (auto-detected)"
                className="w-full text-xs font-mono bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          </details>
        </div>
      )}

      {/* Log panel */}
      {logsOpen && (
        <div className="border-t border-border-subtle">
          <div className="flex items-center justify-between px-4 py-2 bg-surface-2/30">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Process Output
            </span>
            <button
              onClick={() => setLogs([])}
              className="text-[11px] text-text-muted hover:text-text-main cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[13px]">
                delete_sweep
              </span>
              Clear
            </button>
          </div>
          {/* onScroll: pause auto-scroll when user scrolls up, resume when near bottom */}
          <div
            ref={logContainerRef}
            onScroll={handleLogScroll}
            className="max-h-60 overflow-y-auto custom-scrollbar font-mono text-[11px] px-4 py-2 bg-black/20 space-y-0.5"
          >
            {logs.length === 0 ? (
              <p className="text-text-muted/50 py-4 text-center">
                No output yet.
              </p>
            ) : (
              logs.map((entry, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex gap-2 leading-relaxed',
                    LOG_COLORS[entry.stream] ?? LOG_COLORS.stdout
                  )}
                >
                  <span className="text-text-muted/40 shrink-0 select-none">
                    {new Date(entry.ts).toLocaleTimeString('en-US', {
                      hour12: false,
                    })}
                  </span>
                  <span className="break-all whitespace-pre-wrap">
                    {entry.line}
                  </span>
                </div>
              ))
            )}
            <div ref={logBottomRef} />
          </div>
        </div>
      )}
    </div>
  );
}
