/**
 * processManager.js — module-level singleton for the bulk-accounts Python server.
 * Lives server-side only. Module-level state persists for the lifetime of the
 * Node.js process (9router uses a custom server, not serverless functions).
 */

import { spawn } from "child_process";
import { EventEmitter } from "events";
import os from "os";
import fs from "fs";
import path from "path";

const MAX_LOGS = 300;

const _state = {
  proc:       null,
  status:     "stopped",
  pid:        null,
  port:       8765,
  scriptsDir: "",
  startedAt:  null,
  exitCode:   null,
  logs:       [],
  emitter:    new EventEmitter(),
};
_state.emitter.setMaxListeners(100);

const _setup = {
  deps:     "idle",
  camoufox: "idle",
};

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

export function getSetupState() { return { ..._setup }; }

export function getStatus() {
  return {
    status:     _state.status,
    pid:        _state.pid,
    port:       _state.port,
    scriptsDir: _state.scriptsDir,
    startedAt:  _state.startedAt,
    exitCode:   _state.exitCode,
    uptime:     _state.startedAt ? Date.now() - _state.startedAt : null,
    setup:      getSetupState(),
  };
}

export function getLogs() { return [..._state.logs]; }

export function subscribeLog(listener) {
  _state.emitter.on("log", listener);
  return () => _state.emitter.off("log", listener);
}

export function subscribeStatus(listener) {
  _state.emitter.on("status", listener);
  return () => _state.emitter.off("status", listener);
}

export function resolveScriptsDir(override) {
  const bundled = path.join(process.cwd(), "bulk-accounts");
  return override?.trim() || process.env.AUTOMATION_SCRIPTS_DIR?.trim() || bundled;
}

export function resolveDefaultPort() {
  const p = parseInt(process.env.AUTOMATION_SERVER_PORT || "", 10);
  return isNaN(p) ? 8765 : p;
}

export function resolvePython(scriptsDir, explicitPath) {
  if (explicitPath?.trim()) return explicitPath.trim();
  const venvPython = os.platform() === "win32"
    ? path.join(scriptsDir, "venv", "Scripts", "python.exe")
    : path.join(scriptsDir, "venv", "bin", "python");
  if (fs.existsSync(venvPython)) return venvPython;
  return os.platform() === "win32" ? "python" : "python3";
}

export function hasVenv(scriptsDir) {
  const venvPython = os.platform() === "win32"
    ? path.join(scriptsDir, "venv", "Scripts", "python.exe")
    : path.join(scriptsDir, "venv", "bin", "python");
  return fs.existsSync(venvPython);
}

// ── Setup commands ────────────────────────────────────────────────────────────

function spawnSetupCmd(python, args, cwd, key) {
  return new Promise((resolve, reject) => {
    _setup[key] = "running";
    _state.emitter.emit("setup", { ..._setup });
    const proc = spawn(python, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, windowsHide: true });
    proc.stdout.on("data", (c) => c.toString().split("\n").forEach((l) => l.trim() && pushLog(l, "stdout")));
    proc.stderr.on("data", (c) => c.toString().split("\n").forEach((l) => l.trim() && pushLog(l, "stderr")));
    proc.on("error", (err) => { _setup[key] = "error"; pushLog(`[setup] Error: ${err.message}`, "system"); _state.emitter.emit("setup", { ..._setup }); reject(err); });
    proc.on("exit", (code) => {
      _setup[key] = code === 0 ? "done" : "error";
      pushLog(`[setup] ${key} — ${code === 0 ? "✓ done" : "✗ failed (code " + code + ")"}`, "system");
      _state.emitter.emit("setup", { ..._setup });
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`Setup '${key}' failed with code ${code}`));
    });
  });
}

async function checkSetupInstalled(python, cwd) {
  const check = (args) => new Promise((resolve) => {
    const p = spawn(python, args, { cwd, stdio: "ignore", windowsHide: true, env: { ...process.env } });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });

  // Check Python packages via pip show
  const depsOk = await check(["-m", "pip", "show", "aiohttp", "camoufox"]);
  _setup.deps = depsOk ? "done" : "idle";

  // Check camoufox browser binary — try multiple API variants + fallback to ~/.camoufox
  const camoufoxScript = [
    "import sys, os",
    "try:",
    "    import camoufox",
    "    p = None",
    "    for attr in ['get_target', 'get_target_path', '_get_target']:",
    "        fn = getattr(camoufox, attr, None)",
    "        if fn:",
    "            try: p = fn(); break",
    "            except: pass",
    "    if p is None:",
    "        h = os.path.expanduser('~/.camoufox')",
    "        sys.exit(0 if os.path.isdir(h) and os.listdir(h) else 1)",
    "    sys.exit(0 if os.path.exists(str(p)) else 1)",
    "except: sys.exit(1)",
  ].join("\\n");

  const camoufoxOk = await check(["-c", camoufoxScript]);
  _setup.camoufox = camoufoxOk ? "done" : "idle";

  _state.emitter.emit("setup", { ..._setup });
  pushLog(`[setup] Check complete — deps:${_setup.deps} camoufox:${_setup.camoufox}`, "system");
}

export async function runSetup(action, { pythonPath, scriptsDir } = {}) {
  const dir    = resolveScriptsDir(scriptsDir);
  const python = resolvePython(dir, pythonPath);
  pushLog(`[setup] Python: ${python}`, "system");
  pushLog(`[setup] Dir: ${dir}`, "system");

  if (action === "check") {
    await checkSetupInstalled(python, dir);
    return getSetupState();
  }

  if (action === "create-venv") {
    const sysPython = pythonPath?.trim() || (os.platform() === "win32" ? "python" : "python3");
    pushLog("[setup] Creating virtual environment at ./venv ...", "system");
    return new Promise((resolve, reject) => {
      const proc = spawn(sysPython, ["-m", "venv", "venv"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, windowsHide: true });
      proc.stdout.on("data", (c) => c.toString().split("\n").forEach((l) => l.trim() && pushLog(l, "stdout")));
      proc.stderr.on("data", (c) => c.toString().split("\n").forEach((l) => l.trim() && pushLog(l, "stderr")));
      proc.on("error", (e) => { pushLog(`[setup] venv error: ${e.message}`, "system"); reject(e); });
      proc.on("exit", (code) => {
        if (code === 0) {
          pushLog("[setup] ✓ venv created — run Install Deps next", "system");
          _setup.deps = "idle"; _setup.camoufox = "idle";
          _state.emitter.emit("setup", { ..._setup });
          resolve({ ok: true });
        } else {
          pushLog(`[setup] ✗ venv creation failed (code ${code})`, "system");
          reject(new Error("venv creation failed"));
        }
      });
    });
  }

  if (action === "install-deps") {
    if (_setup.deps === "running") throw new Error("Already running");
    pushLog("[setup] Installing Python dependencies...", "system");
    return spawnSetupCmd(python, ["-m", "pip", "install", "-r", "requirements-harvest.txt"], dir, "deps");
  }

  if (action === "install-camoufox") {
    if (_setup.camoufox === "running") throw new Error("Already running");
    pushLog("[setup] Downloading Camoufox browser (this may take a few minutes)...", "system");
    return spawnSetupCmd(python, ["-m", "camoufox", "fetch"], dir, "camoufox");
  }

  if (action === "install-all") {
    pushLog("[setup] Running full setup: deps + camoufox...", "system");
    await spawnSetupCmd(python, ["-m", "pip", "install", "-r", "requirements-harvest.txt"], dir, "deps");
    await spawnSetupCmd(python, ["-m", "camoufox", "fetch"], dir, "camoufox");
    return getSetupState();
  }

  throw new Error(`Unknown setup action: ${action}`);
}

// ── Server spawn ──────────────────────────────────────────────────────────────

export async function startServer({ pythonPath, scriptsDir, port } = {}) {
  if (_state.proc) throw new Error("Server is already running (pid " + _state.pid + ")");

  const resolvedDir  = resolveScriptsDir(scriptsDir);
  const resolvedPort = port || resolveDefaultPort();
  const python       = resolvePython(resolvedDir, pythonPath);

  if (!resolvedDir) throw new Error("scriptsDir is required");

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

  pushLog(`[manager] Python: ${python}`, "system");
  pushLog(`[manager] Spawning: server.py --port ${resolvedPort}`, "system");
  pushLog(`[manager] Dir: ${resolvedDir}`, "system");

  const proc = spawn(python, ["server.py", "--port", String(resolvedPort)], {
    cwd: resolvedDir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env }, windowsHide: true,
  });

  _state.proc = proc;
  _state.pid  = proc.pid;
  pushLog(`[manager] Process started — pid ${proc.pid}`, "system");

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      pushLog(line, "stdout");
      if (line.includes("[server] Dashboard") || line.includes("[server] WebSocket") || line.includes("Application startup complete")) {
        _state.startedAt = Date.now();
        setStatus("running");
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n")) { if (line.trim()) pushLog(line, "stderr"); }
  });

  proc.on("error", (err) => {
    pushLog(`[manager] Spawn error: ${err.message}`, "system");
    _state.proc = null; _state.pid = null; _state.startedAt = null;
    setStatus("error");
  });

  proc.on("exit", (code, signal) => {
    pushLog(`[manager] Process exited — code=${code} signal=${signal}`, "system");
    _state.proc = null; _state.pid = null; _state.exitCode = code; _state.startedAt = null;
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
    if (_state.proc) { pushLog("[manager] Force kill (SIGKILL)...", "system"); _state.proc.kill("SIGKILL"); }
  }, 5000);
  return true;
}

process.on("exit", () => {
  if (_state.proc) { try { _state.proc.kill("SIGKILL"); } catch { /* ignore */ } }
});
