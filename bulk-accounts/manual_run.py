#!/usr/bin/env python3
"""
manual_run.py — Sequential Interactive Terminal Harvester
==========================================================
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# ── Bootstrap ─────────────────────────────────────────────────────────────────
from core.bootstrap import Bootstrap
Bootstrap.run()

from core.browser import cleanup_camoufox_temp
from core.cli import load_accounts, validate_providers
from core.config import Config
from core.emit import Emit
from core.interact_terminal import terminal_interact_gate
from core.output import OutputWriter
from core.ui import (
    UIState, TUIDashboard, color as _c, ok, err, warn, banner,
    NullWriter, _sys_stderr, emit_as_terminal_log,
)
from core.worker import HarvestWorker

# ── Configuration ─────────────────────────────────────────────────────────────
os.environ["BATCHER_CAMOUFOX_HEADLESS"] = "false"

# Patch interact_gate ke terminal mode
import core.interact as _ci
_ci.interact_gate = terminal_interact_gate

# TUI-aware emit bridge: update dashboard status + shared log
def _tui_emit(data: dict) -> None:
    email = data.get("email")
    if email and data.get("type") == "progress":
        UIState.task_statuses[email] = data.get("message") or "Harvesting..."
    emit_as_terminal_log(data)

# ── Summary printer ───────────────────────────────────────────────────────────
def print_account_summary(email: str, results: dict) -> None:
    parts = [_c(f"\n  Summary — {email}", "1;94")]
    api_keys = results.get("api_keys", {})
    if not api_keys:
        parts.append(_c("    ✗ No keys harvested", "91"))
    else:
        for pname, val in api_keys.items():
            disp = Config.PROVIDER_REGISTRY.get(pname, {}).get("display", pname)
            parts.append(_c(f"    {disp:<35} {'✓ connected' if val == '__connected__' else val[:40]}", "92"))
    UIState.log("\n".join(parts))

# ── Main ──────────────────────────────────────────────────────────────────────
async def main() -> None:
    parser = argparse.ArgumentParser(prog="manual_run.py", description="Interactive harvester")
    parser.add_argument("--file", "-f", help="accounts.txt (email:password)")
    parser.add_argument("--accounts", "-a", default="accounts.json", help="accounts.json")
    parser.add_argument("--email", "-e")
    parser.add_argument("--password", "-p")
    parser.add_argument("--providers", default="all", help="CSV or all")
    parser.add_argument("--output-dir", default="outputs")
    parser.add_argument("--concurrent", "-c", type=int, default=1)
    parser.add_argument("--timeout", "-t", type=float, default=0, help="0 = unlimited")
    parser.add_argument("--google-login", action="store_true", default=False, help="Force Google login first")
    parser.add_argument("--dashboard-login", action="store_true", default=False, help="Force Dashboard login first")
    parser.add_argument("--loop", "-l", action="store_true")
    args = parser.parse_args()

    accounts = load_accounts(args)
    if not accounts: sys.exit(1)

    providers = validate_providers(args.providers)
    if not providers: sys.exit(1)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    sys.stderr = NullWriter()
    logging.getLogger().setLevel(logging.ERROR)

    banner(f"Harvester — {len(accounts)} accounts, {len(providers)} providers")
    all_results, ts = [], datetime.now().strftime("%Y%m%d-%H%M%S")
    out_path = out_dir / f"harvest-{ts}.txt"
    
    sem = asyncio.Semaphore(args.concurrent)
    lock = asyncio.Lock()
    
    # Set centralized callback
    Emit.set_callback(_tui_emit)

    async def worker_task(index: int, acc: dict) -> None:
        async with sem:
            idx_str = f"[{index}/{len(accounts)}] "
            UIState.task_statuses[acc["email"]] = "Initiating..."
            
            # Gateway logic: Semua kecuali kiro butuh login dlu
            force_google = args.google_login or "kiro" not in providers
            
            worker = HarvestWorker(
                index, acc["email"], acc["password"], providers, 
                timeout_per_provider=args.timeout,
                force_google_login=force_google
            )
            try:
                UIState.task_statuses[acc["email"]] = "Harvesting..."
                res = await worker.run()
                async with lock:
                    all_results.append(res)
                    print_account_summary(acc["email"], res)
                    OutputWriter.save(all_results, out_path)
            finally:
                cleanup_camoufox_temp()

    dashboard_task = asyncio.create_task(TUIDashboard.loop())
    try:
        while True:
            tasks = [asyncio.create_task(worker_task(i, acc)) for i, acc in enumerate(accounts, 1)]
            if tasks: await asyncio.gather(*tasks)
            if not args.loop: break
            await asyncio.sleep(5)
    finally:
        sys.stderr = _sys_stderr
        dashboard_task.cancel()
        Emit.set_callback(None)
        _ci.interact_gate = terminal_interact_gate  # keep patch for cleanup

    # ── Final Proxy Sync ──────────────────────────────────────────────────────
    try:
        from core.browser import BrowserManager
        from harvest.dashboard import apply_proxy_to_all_providers
        manager, browser, page = await BrowserManager.launch(slot=0, email="system")
        await apply_proxy_to_all_providers(page)
        await manager.close()
    except Exception as _pe:
        UIState.log(f"  ⚠ Proxy Sync failed: {_pe}")

    banner(f"Done! Saved to {out_path.name}")

if __name__ == "__main__":
    try: asyncio.run(main())
    except KeyboardInterrupt: print(_c("\n\nStopped.", "93"), flush=True)
