/**
 * processManager.js — module-level singleton for the bulk-accounts Python server.
 *
 * Lives server-side only (imported from API routes).
 * Module-level state persists for the lifetime of the Node.js process because
 * 9router uses a custom server (custom-server.js), not serverless functions.
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";
import os from "os";

const MAX_LOGS = 300;

const _state = {
  proc:      null,
  status:    "stopped", // "stopped" | "starting" | "running" | "stopping" | "error"
  pid:       null,
  port:      8765,
  startedAt: null,
  exitCode:  null,
  logs:      [],        // ring buffer of { ts, line, stream }
  emitter:   new EventEmitter(),
};

_state.emitter.setMaxListeners(100);

// ── helpers ─────────────────────────────────────────────────────────────────

function pushLog(line, stream = "stdout") {
  const entry = { ts: new Date().toISOString(), line: line.trimEnd(), stream };
  _state.logs.push(entry);
  if (_state.logs.length > MAX_LOGS) _state.logs.shift();
  _state.emitter.emit("log", entry);
}

function setStatus(status) {
  _state.status = status;
  _state.emitter.emit("status", status);
}

// ── public API ───────────────────────────────────────────────────────────────

export function getStatus() {
  return {
    status:    _state.status,
    pid:       _state.pid,
    port:      _state.port,
    startedAt: _state.startedAt,
    exitCode:  _state.exitCode,
    uptime:    _state.startedAt ? Date.now() - _state.startedAt : null,
  };
}

export function getLogs() {
  return [..._state.logs];
}

/** Subscribe to live log entries. Returns unsubscribe fn. */
export function subscribeLog(listener) {
  _state.emitter.on("log", listener);
  return () => _state.emitter.off("log", listener);
}

/** Subscribe to status changes. Returns unsubscribe fn. */
export function subscribeStatus(listener) {
  _state.emitter.on("status", listener);
  return () => _state.emitter.off("status", listener);
}

/**
 * Spawn the Python server process.
 * @param {{ pythonPath?: string, scriptsDir: string, port?: number }} opts
 */
export function startServer({ pythonPath, scriptsDir, port = 8765 }) {
  if (_state.proc) {
    throw new Error("Server is already running (pid " + _state.pid + ")");
  }
  if (!scriptsDir) {
    throw new Error("scriptsDir is required — set the path to your bulk-accounts folder");
  }

  const python = pythonPath || (os.platform() === "win32" ? "python" : "python3");

  _state.port      = port;
  _state.exitCode  = null;
  _state.startedAt = null;
  _state.logs      = [];
  setStatus("starting");

  pushLog(`[manager] Spawning: ${python} server.py --port ${port}`, "system");
  pushLog(`[manager] Working dir: ${scriptsDir}`, "system");

  const proc = spawn(python, ["server.py", "--port", String(port)], {
    cwd: scriptsDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    // On Windows, don't open a console window
    windowsHide: true,
  });

  _state.proc = proc;
  _state.pid  = proc.pid;

  pushLog(`[manager] Process started — pid ${proc.pid}`, "system");

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      pushLog(line, "stdout");
      // Detect ready signal from server.py stdout
      if (
        line.includes("[server] Dashboard") ||
        line.includes("[server] WebSocket") ||
        line.includes("Application startup complete")
      ) {
        _state.startedAt = Date.now();
        setStatus("running");
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      pushLog(line, "stderr");
    }
  });

  proc.on("error", (err) => {
    pushLog(`[manager] Spawn error: ${err.message}`, "system");
    _state.proc      = null;
    _state.pid       = null;
    _state.startedAt = null;
    setStatus("error");
  });

  proc.on("exit", (code, signal) => {
    pushLog(`[manager] Process exited — code=${code} signal=${signal}`, "system");
    _state.proc      = null;
    _state.pid       = null;
    _state.exitCode  = code;
    _state.startedAt = null;
    setStatus(code === 0 || signal === "SIGTERM" ? "stopped" : "error");
  });

  return { pid: proc.pid };
}

/** Send SIGTERM then SIGKILL after 5 s. */
export function stopServer() {
  if (!_state.proc) return false;
  setStatus("stopping");
  pushLog("[manager] Sending SIGTERM...", "system");
  _state.proc.kill("SIGTERM");
  setTimeout(() => {
    if (_state.proc) {
      pushLog("[manager] Force kill (SIGKILL)...", "system");
      _state.proc.kill("SIGKILL");
    }
  }, 5000);
  return true;
}

// Kill child on Node.js exit so we don't leave orphan Python processes
process.on("exit", () => {
  if (_state.proc) {
    try { _state.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
});
