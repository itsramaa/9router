#!/usr/bin/env python3
"""
server.py — Dashboard WebSocket + HTTP server
==============================================
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from core.config import Config

# WSLg / X11 display fix — set DISPLAY if not already set so headless=False works
if not os.environ.get("DISPLAY"):
    os.environ["DISPLAY"] = ":0"
if not os.environ.get("WAYLAND_DISPLAY"):
    os.environ["WAYLAND_DISPLAY"] = "wayland-0"

try:
    import aiohttp
except ImportError:
    import subprocess
    print("[server] Dependencies missing. Running bootstrap via run.py...", flush=True)
    _run_py = Path(__file__).parent / "run.py"
    if _run_py.exists():
        subprocess.run([sys.executable, str(_run_py), "--help"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import aiohttp
    except ImportError:
        print("[server] Fatal: Could not install dependencies. Please run: pip install -r requirements-harvest.txt", file=sys.stderr)
        sys.exit(1)

from aiohttp import web

from srv.handlers import ServerHandlers
from srv.state import ServerState
from srv.ws import WebSocketManager


def create_app() -> web.Application:
    state = ServerState()
    ws_mgr = WebSocketManager(state)
    handlers = ServerHandlers(state, ws_mgr)

    app = web.Application()
    app.router.add_get("/",                handlers.handle_index)
    app.router.add_get("/api/accounts",    handlers.handle_accounts)
    app.router.add_post("/api/save_accounts", handlers.handle_save_accounts)
    app.router.add_get("/api/results",     handlers.handle_results)
    app.router.add_post("/api/start",      handlers.handle_start)
    app.router.add_post("/api/stop",       handlers.handle_stop)
    app.router.add_post("/api/interact",   handlers.handle_interact)
    app.router.add_get("/api/progress",    handlers.handle_progress)
    app.router.add_post("/api/reset",          handlers.handle_reset)
    app.router.add_get("/api/backups",         handlers.handle_list_backups)
    app.router.add_post("/api/backups/import", handlers.handle_restore_backup)
    app.router.add_get("/ws",              ws_mgr.handle_ws)

    dist_dir = Path(__file__).parent / "dashboard" / "dist"
    if dist_dir.exists():
        assets_dir = dist_dir / "assets"
        if assets_dir.exists():
            app.router.add_static("/assets", assets_dir)

    return app


if __name__ == "__main__":
    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception as _e:
            logging.warning(f'Server swallowed exception during stdout reconfigure: {_e}')

    # Derive port from Config
    try:
        default_port = int(Config.DASHBOARD_BASE_URL.split(":")[-1])
    except Exception:
        default_port = 20128

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=default_port)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--dev", action="store_true", help="Auto-rebuild frontend on changes (runs npm run build --watch)")
    args = p.parse_args()

    if args.dev:
        import subprocess
        npm_dir = Path(__file__).parent / "dashboard"
        _build_watch = subprocess.Popen(
            ["npx", "vite", "build", "--watch"],
            cwd=str(npm_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        import atexit
        atexit.register(lambda: _build_watch.terminate() if _build_watch.poll() is None else None)
        print(f"[server] Dev mode: watching dashboard/src/ for changes...", flush=True)

    print(f"[server] Dashboard  -> http://{args.host}:{args.port}", flush=True)
    print(f"[server] WebSocket  -> ws://{args.host}:{args.port}/ws", flush=True)
    print(f"[server] Press Ctrl+C to stop", flush=True)
    web.run_app(create_app(), host=args.host, port=args.port, print=None)
