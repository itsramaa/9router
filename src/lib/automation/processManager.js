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
import fs from "fs";
import path from "path";

const MAX_LOGS = 300;

const _state = {
  proc:      null,
  status:    "stopped", // "stopped" | "starting" | "running" | "stopping" | "error"
  pid:       null,
  port:      8765,
  scriptsDir: "",
  startedAt: null,
  exitCode:  null,
  logs:      [],
  emitter:   new EventEmitter(),
};

_state.emitter.setMaxListeners(100);

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

export function getStatus() {
  return {
    status:     _state.status,
    pid:        _state.pid,
    port:       _state.port,
    scriptsDir: _state.scriptsDir,
    startedAt:  _state.startedAt,
    exitCode:   _state.exitCode,
    uptime:     _state.startedAt ? Date.now() - _state.startedAt : null,
  };
}

export function getLogs() {
  return [..._state.logs];
}

export function subscribeLog(listener) {
  _state.emitter.on("log", listener);
  return () => _state.emitter.off("log", listener);
}

export function subscribeStatus(listener) {
  _state.emitter.on("status", listener);
  return () => _state.emitter.off("status", listener);
}

export function resolveScriptsDir(override) {
  return override?.trim() || process.env.AUTOMATION_SCRIPTS_DIR?.trim() || "";
}

export function resolveDefaultPort() {
  const p = parseInt(process.env.AUTOMATION_SERVER_PORT || "", 10);
  return isNaN(p) ? 8765 : p;
}

/**
 * Spawn the Python server process.
 * Syncs accounts from 9router DB → accounts.json before spawning.
 */
export async function startServer({ pythonPath, scriptsDir, port } = {}) {
  if (_state.proc) {
    throw new Error("Server is already running (pid " + _state.pid + ")");
  }

  const resolvedDir  = resolveScriptsDir(scriptsDir);
  const resolvedPort = port || resolveDefaultPort();
  const python       = pythonPath?.trim() || (os.platform() === "win32" ? "python" : "python3");

  if (!resolvedDir) {
    throw new Error("scriptsDir is required — set AUTOMATION_SCRIPTS_DIR env var or pass it explicitly");
  }

  // Sync accounts from 9router DB → accounts.json before spawning
  try {
    const { getAutomationAccountsForSync } = await import("../db/repos/automationAccountsRepo.js");
    const accounts = await getAutomationAccountsForSync();
    if (accounts.length > 0) {
      const accountsPath = path.join(resolvedDir, "accounts.json");
      const tmp = accountsPath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), "utf-8");
      fs.renameSync(tmp, accountsPath);
      pushLog(`[manager] Synced ${accounts.length} account(s) → accounts.json`, "system");
    } else {
      pushLog("[manager] No accounts in DB — skipping accounts.json sync", "system");
    }
  } catch (e) {
    pushLog(`[manager] Account sync warning: ${e.message}`, "system");
  }

  _state.port       = resolvedPort;
  _state.scriptsDir = resolvedDir;
  _state.exitCode   = null;
  _state.startedAt  = null;
  _state.logs       = [];
  setStatus("starting");

  pushLog(`[manager] Spawning: ${python} server.py --port ${resolvedPort}`, "system");
  pushLog(`[manager] Working dir: ${resolvedDir}`, "system");

  const proc = spawn(python, ["server.py", "--port", String(resolvedPort)], {
    cwd: resolvedDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    windowsHide: true,
  });

  _state.proc = proc;
  _state.pid  = proc.pid;

  pushLog(`[manager] Process started — pid ${proc.pid}`, "system");

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      pushLog(line, "stdout");
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

process.on("exit", () => {
  if (_state.proc) {
    try { _state.proc.kill("SIGKILL"); } catch { /* ignore */ }
  }
});
