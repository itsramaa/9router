"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/shared/utils/cn";

const STATUS_CFG = {
  stopped:  { dot: "bg-surface-2 border border-border-subtle", label: "Stopped",  color: "text-text-muted",                    border: "border-border-subtle" },
  starting: { dot: "bg-amber-400 animate-pulse",               label: "Starting", color: "text-amber-600 dark:text-amber-400", border: "border-amber-400/30" },
  running:  { dot: "bg-green-500 animate-pulse",               label: "Running",  color: "text-green-600 dark:text-green-400", border: "border-green-500/30" },
  stopping: { dot: "bg-amber-400 animate-pulse",               label: "Stopping", color: "text-amber-600 dark:text-amber-400", border: "border-amber-400/30" },
  error:    { dot: "bg-red-500",                               label: "Error",    color: "text-red-500",                        border: "border-red-500/30" },
};

const LOG_COLORS = {
  stdout: "text-text-main",
  stderr: "text-amber-500 dark:text-amber-400",
  system: "text-blue-500 dark:text-blue-400",
};

const LS_KEY = "automation_server_cfg";

function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { pythonPath: "", scriptsDir: "", port: "8765" };
}

function saveConfig(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

function formatUptime(ms) {
  if (!ms) return "0s";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export default function ServerManager({ onServerReady }) {
  const [cfg, setCfg]           = useState({ pythonPath: "", scriptsDir: "", port: "8765" });
  const [status, setStatus]     = useState("stopped");
  const [pid, setPid]           = useState(null);
  const [uptime, setUptime]     = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError]       = useState("");
  const [logs, setLogs]         = useState([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [cfgOpen, setCfgOpen]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const logBottomRef            = useRef(null);
  const esRef                   = useRef(null);
  const pollRef                 = useRef(null);

  // Load config from localStorage once on mount
  useEffect(() => {
    setCfg(loadConfig());
  }, []);

  // Uptime ticker
  useEffect(() => {
    if (status !== "running" || !startedAt) { setUptime(null); return; }
    const tick = () => setUptime(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsOpen) logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, logsOpen]);

  // SSE log stream
  const connectLogStream = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    const es = new EventSource("/api/automation/server/logs");
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > 300 ? next.slice(next.length - 300) : next;
        });
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  // Poll server status
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/server");
      if (!res.ok) return;
      const data = await res.json();
      setStatus(data.status);
      setPid(data.pid);
      setStartedAt(data.startedAt);
      if (data.status === "running" && onServerReady) {
        onServerReady(data.port);
      }
    } catch { /* ignore */ }
  }, [onServerReady]);

  useEffect(() => {
    pollStatus();
    connectLogStream();
    pollRef.current = setInterval(pollStatus, 2000);
    return () => {
      clearInterval(pollRef.current);
      esRef.current?.close();
    };
  }, [pollStatus, connectLogStream]);

  function handleCfgChange(key, val) {
    const next = { ...cfg, [key]: val };
    setCfg(next);
    saveConfig(next);
  }

  async function handleStart() {
    setError("");
    setBusy(true);
    setLogs([]);
    try {
      const res = await fetch("/api/automation/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          pythonPath: cfg.pythonPath || undefined,
          scriptsDir: cfg.scriptsDir,
          port: Number(cfg.port) || 8765,
        }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error || "Failed to start"); }
      else { connectLogStream(); setLogsOpen(true); }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await fetch("/api/automation/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
    } finally {
      setBusy(false);
    }
  }

  const st = STATUS_CFG[status] ?? STATUS_CFG.stopped;
  const isRunning  = status === "running";
  const isBusy     = status === "starting" || status === "stopping" || busy;
  const canStart   = !isBusy && (status === "stopped" || status === "error");
  const canStop    = !busy && (isRunning || status === "starting");

  return (
    <div className={cn("rounded-[14px] border bg-surface shadow-[var(--shadow-soft)] overflow-hidden transition-colors", st.border)}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn("flex items-center justify-center size-8 rounded-lg shrink-0",
          isRunning ? "bg-green-500/10" : "bg-surface-2"
        )}>
          <span className={cn("material-symbols-outlined text-[18px]",
            isRunning ? "text-green-500" : "text-text-muted"
          )}>terminal</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-main">bulk-accounts Server</span>
            <div className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full shrink-0", st.dot)} />
              <span className={cn("text-xs font-semibold", st.color)}>{st.label}</span>
            </div>
            {isRunning && pid && (
              <span className="text-[10px] text-text-muted font-mono">pid:{pid}</span>
            )}
            {isRunning && uptime != null && (
              <span className="text-[10px] text-green-600/80 dark:text-green-400/70">↑ {formatUptime(uptime)}</span>
            )}
          </div>
          <p className="text-[11px] text-text-muted truncate">
            {isRunning
              ? `Listening on :${cfg.port} — WS auto-connected`
              : "Python server for bulk-accounts harvester"}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Config toggle */}
          <button
            onClick={() => setCfgOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
              cfgOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border-subtle text-text-muted hover:bg-surface-2 hover:text-text-main"
            )}
          >
            <span className="material-symbols-outlined text-[14px]">settings</span>
            Config
          </button>

          {/* Log toggle */}
          <button
            onClick={() => setLogsOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer",
              logsOpen
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border-subtle text-text-muted hover:bg-surface-2 hover:text-text-main"
            )}
          >
            <span className="material-symbols-outlined text-[14px]">article</span>
            Logs
            {logs.length > 0 && (
              <span className="px-1 rounded-full bg-surface-2 text-text-muted text-[10px] font-mono">{logs.length}</span>
            )}
          </button>

          {/* Stop */}
          <button
            onClick={handleStop}
            disabled={!canStop}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-30 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">stop</span>
            Stop
          </button>

          {/* Start */}
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-30 cursor-pointer shadow-[var(--shadow-warm)]"
          >
            <span className={cn("material-symbols-outlined text-[14px]", isBusy ? "animate-spin" : "")}>
              {isBusy ? "sync" : "play_arrow"}
            </span>
            {status === "starting" ? "Starting..." : status === "stopping" ? "Stopping..." : "Start"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/5 flex items-start gap-2">
          <span className="material-symbols-outlined text-[14px] text-red-500 shrink-0 mt-px">error</span>
          <p className="text-xs text-red-500">{error}</p>
          <button onClick={() => setError("")} className="ml-auto text-red-400 hover:text-red-500 cursor-pointer shrink-0">
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        </div>
      )}

      {/* Config panel */}
      {cfgOpen && (
        <div className="border-t border-border-subtle bg-surface-2/30 px-4 py-3 space-y-3">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Server Configuration</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Python Executable</label>
              <input
                type="text"
                value={cfg.pythonPath}
                onChange={(e) => handleCfgChange("pythonPath", e.target.value)}
                placeholder="python  (or python3)"
                className="w-full text-xs font-mono bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">Port</label>
              <input
                type="number"
                value={cfg.port}
                onChange={(e) => handleCfgChange("port", e.target.value)}
                className="w-full text-xs font-mono bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-text-main focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            <div className="sm:col-span-1" />
            <div className="sm:col-span-3">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
                bulk-accounts Directory <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={cfg.scriptsDir}
                onChange={(e) => handleCfgChange("scriptsDir", e.target.value)}
                placeholder="e.g. C:\Users\you\bulk-accounts  or  /home/you/bulk-accounts"
                className="w-full text-xs font-mono bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <p className="mt-1 text-[10px] text-text-muted">Absolute path to the folder containing server.py</p>
            </div>
          </div>
        </div>
      )}

      {/* Log panel */}
      {logsOpen && (
        <div className="border-t border-border-subtle">
          <div className="flex items-center justify-between px-4 py-2 bg-surface-2/30">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Process Output</span>
            <button onClick={() => setLogs([])} className="text-[11px] text-text-muted hover:text-text-main cursor-pointer flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">delete_sweep</span>
              Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto custom-scrollbar font-mono text-[11px] px-4 py-2 bg-black/20 space-y-0.5">
            {logs.length === 0 ? (
              <p className="text-text-muted/50 py-4 text-center">No output yet. Start the server to see logs.</p>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className={cn("flex gap-2 leading-relaxed", LOG_COLORS[entry.stream] ?? LOG_COLORS.stdout)}>
                  <span className="text-text-muted/40 shrink-0 select-none">
                    {new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span className="break-all whitespace-pre-wrap">{entry.line}</span>
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
