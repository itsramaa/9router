#!/usr/bin/env python3
"""
run.py — Bulk API Key Harvester Entry Point (Non-Interactive / Concurrent Mode)
================================================================================
INTERACTIVE_MODE=False → Full concurrent, log-only, zero manual pause.
Post-run: UI muncul untuk retry provider yang gagal, langsung ke provider itu.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import random
import sys
import atexit
from datetime import datetime
from pathlib import Path

from core.bootstrap import Bootstrap
Bootstrap.run()

from core.browser import BrowserManager, cleanup_camoufox_temp
from core.checkpoint import CheckpointManager
from core.cli import load_accounts, validate_providers
from core.config import Config
from core.emit import Emit
from core.output import OutputWriter
from core.proxy import ProxyManager
from core.ui import color as _c, NullWriter, _sys_stderr, emit_as_terminal_log
from core.worker import HarvestWorker
from harvest.dashboard import dashboard_login



def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="run.py", description="Bulk API Key Harvester (Non-Interactive)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python run.py --file accounts.txt
  python run.py --file accounts.txt --concurrent 3 --proxy http://user:pass@host:port
  python run.py --accounts accounts.json --providers groq,gemini --concurrent 2
  python run.py --email user@gmail.com --password mypass --providers all
        """)
    src = p.add_argument_group("Account Sources (pick one)")
    src.add_argument("--file", "-f", metavar="FILE.txt", help="Txt file with email:password per line")
    src.add_argument("--accounts", "-a", metavar="FILE.json", default="accounts.json",
                     help="JSON file [{email, password}, ...] (default: accounts.json)")
    src.add_argument("--email", "-e", metavar="EMAIL", help="Single email (use with --password)")
    src.add_argument("--password", "-p", metavar="PASSWORD", help="Single password (use with --email)")

    cfg = p.add_argument_group("Settings")
    cfg.add_argument("--concurrent", "-c", type=int, default=2, metavar="N",
                     help="Number of concurrent browser sessions (default: 2)")
    cfg.add_argument("--proxy", metavar="URL", default="", help="Proxy URL e.g. http://user:pass@host:port")
    cfg.add_argument("--providers", default="all", metavar="LIST",
                     help=("Comma-separated providers or 'all' (default: all)\nOptions: " + ", ".join(Config.ALL_PROVIDERS)))
    cfg.add_argument("--resume", "-r", action="store_true", default=False,
                     help="Resume from last checkpoint (skip already completed accounts)")
    cfg.add_argument("--timeout", type=float, default=500.0, metavar="SECONDS",
                     help="Timeout per provider per account (default: 500)")
    cfg.add_argument("--output-dir", default="outputs", metavar="DIR", help="Output directory (default: outputs/)")
    cfg.add_argument("--google-login", action="store_true", default=False,
                     help="Force Google login flow at the start of each account")
    cfg.add_argument("--dashboard-login", action="store_true", default=False,
                     help="Force Dashboard login flow at the start of each account")
    cfg.add_argument("--headless", action="store_true", default=True,
                     help="Run browser in headless mode")
    cfg.add_argument("--server", "-s", action="store_true", help="Run the dashboard web server instead of CLI harvester")
    cfg.add_argument("--port", type=int, default=8765, help="Dashboard server port (default: 8765)")
    return p


# ── Phase 1: Concurrent harvest (log-only, no interact) ───────────────────────

async def run_harvest_phase(
    accounts: list[dict],
    providers: list[str],
    concurrent: int,
    proxy_mgr: ProxyManager,
    timeout: float,
    cp_mgr: CheckpointManager,
    google_login: bool = False,
    dashboard_login: bool = False,
) -> list[dict]:
    """Jalankan semua akun secara concurrent. Zero interact_gate."""
    slot_queue: asyncio.Queue[int] = asyncio.Queue()
    for i in range(concurrent):
        slot_queue.put_nowait(i + 1)

    semaphore = asyncio.Semaphore(concurrent)
    all_results: list[dict] = []

    async def run_one(account: dict) -> dict:
        async with semaphore:
            await asyncio.sleep(random.uniform(0.5, 3.0))
            slot = await slot_queue.get()
            try:
                active_proxy = await proxy_mgr.get_next_proxy()
                if active_proxy:
                    print(f"  [Slot {slot}] Using proxy: {active_proxy}", flush=True)

                worker = HarvestWorker(
                    slot=slot, email=account["email"], password=account["password"],
                    providers=providers, proxy_url=active_proxy,
                    timeout_per_provider=timeout,
                    force_google_login=google_login,
                    force_dashboard_login=dashboard_login,
                )
                result = await worker.run()

                # Checkpoint
                try:
                    async with cp_mgr.lock:
                        cp_mgr.data["completed"][account["email"]] = {
                            "api_keys": result.get("api_keys", {}),
                            "errors": result.get("errors", {}),
                            "slot": slot,
                            "timestamp": datetime.now().isoformat(),
                        }
                        cp_mgr.data["total_keys"] = sum(
                            len(v.get("api_keys", {})) for v in cp_mgr.data["completed"].values()
                        )
                        await cp_mgr.save()
                except Exception as _e:
                    logging.warning(f"Checkpoint save error: {_e}")

                return result
            finally:
                cleanup_camoufox_temp()
                slot_queue.put_nowait(slot)

    tasks = [asyncio.create_task(run_one(acc)) for acc in accounts]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, Exception):
            all_results.append({"email": "unknown", "api_keys": {}, "errors": {"_exception": str(r)}})
        else:
            all_results.append(r)

    return all_results


# ── Phase 2: Post-run retry UI ────────────────────────────────────────────────

async def run_retry_phase(
    all_results: list[dict],
    accounts: list[dict],
    proxy_mgr: ProxyManager,
    concurrent: int,
    timeout: float,
    output_dir: Path,
) -> int:
    """
    Setelah semua selesai, tampilkan UI retry untuk provider yang gagal.
    Patch interact_gate ke terminal_interact_gate untuk sesi retry.
    Return jumlah tambahan keys yang berhasil di-retry.
    """
    # Kumpulkan failures
    failures: dict[str, list[str]] = {}
    result_map: dict[str, dict] = {}
    for r in all_results:
        email = r.get("email", "")
        failed = r.get("failed_providers", [])
        if failed:
            failures[email] = list(failed)
            result_map[email] = r

    if not failures:
        return 0

    # Print summary failures
    print("\n" + _c("═" * 62, "93"), flush=True)
    print(_c("  ⚠  POST-RUN RETRY — Provider yang gagal:", "1;93"), flush=True)
    print(_c("═" * 62, "93"), flush=True)
    entries = list(failures.items())
    for i, (email, provs) in enumerate(entries, 1):
        prov_names = ", ".join(
            Config.PROVIDER_REGISTRY.get(p, {}).get("display", p) for p in provs
        )
        print(f"  {_c(str(i), '1;96')}. {email}  →  {_c(prov_names, '91')}", flush=True)
    print(_c("═" * 62, "93"), flush=True)
    print("  Ketik nomor untuk retry, atau ENTER untuk selesai.", flush=True)

    # Patch interact_gate ke terminal_interact_gate untuk retry sessions
    import core.interact as _ci
    from core.interact_terminal import terminal_interact_gate
    _original_gate = _ci.interact_gate
    _ci.interact_gate = terminal_interact_gate
    Config.INTERACTIVE_MODE = True  # Enable interact untuk retry
    
    # Fase retry WAJIB kelihatan (headless=False) biar bisa solve captcha/verify
    os.environ["BATCHER_CAMOUFOX_HEADLESS"] = "false"

    slot_queue: asyncio.Queue[int] = asyncio.Queue()
    for i in range(concurrent):
        slot_queue.put_nowait(i + 1)
    retry_sem = asyncio.Semaphore(concurrent)

    extra_keys = 0

    async def do_retry(acc: dict, provs: list[str]) -> dict:
        async with retry_sem:
            slot = await slot_queue.get()
            try:
                active_proxy = await proxy_mgr.get_next_proxy()
                
                # Hanya force login jika Kiro tidak ada di list retry
                force_google = "kiro" not in provs
                
                worker = HarvestWorker(
                    slot=slot, email=acc["email"], password=acc["password"],
                    providers=provs, proxy_url=active_proxy,
                    timeout_per_provider=timeout,
                    force_google_login=force_google,
                    force_dashboard_login=dashboard_login,
                )
                return await worker.run()
            finally:
                cleanup_camoufox_temp()
                slot_queue.put_nowait(slot)

    try:
        loop = asyncio.get_running_loop()
        while entries:
            # Prompt input di thread executor agar tidak block event loop
            choice_raw = await loop.run_in_executor(
                None,
                lambda: input(_c(f"\n  Pilih [1-{len(entries)}/Enter=selesai] > ", "96"))
            )
            choice = choice_raw.strip()

            if not choice:
                break
            if not choice.isdigit() or not (1 <= int(choice) <= len(entries)):
                print("  Input tidak valid.", flush=True)
                continue

            idx = int(choice) - 1
            email, failed_provs = entries[idx]
            account_info = next((a for a in accounts if a["email"] == email), None)
            if not account_info:
                print(f"  Akun {email} tidak ditemukan.", flush=True)
                continue

            # Pilih provider spesifik atau semua
            print(f"\n  Provider gagal untuk {_c(email, '96')}:", flush=True)
            for j, p in enumerate(failed_provs, 1):
                disp = Config.PROVIDER_REGISTRY.get(p, {}).get("display", p)
                print(f"    {_c(str(j), '1')}. {disp}", flush=True)
            print(f"    {_c('a', '1')}. Retry semua", flush=True)

            prov_choice_raw = await loop.run_in_executor(
                None,
                lambda: input(_c(f"  Pilih [1-{len(failed_provs)}/a] > ", "96"))
            )
            prov_choice = prov_choice_raw.strip().lower()

            if prov_choice == "a":
                retry_provs = list(failed_provs)
            elif prov_choice.isdigit() and 1 <= int(prov_choice) <= len(failed_provs):
                retry_provs = [failed_provs[int(prov_choice) - 1]]
            else:
                print("  Input tidak valid.", flush=True)
                continue

            prov_names = ", ".join(
                Config.PROVIDER_REGISTRY.get(p, {}).get("display", p) for p in retry_provs
            )
            print(f"\n  Retrying {_c(email, '96')} → {_c(prov_names, '93')}...", flush=True)

            retry_result = await do_retry(account_info, retry_provs)

            # Merge hasil
            orig = result_map.get(email, {})
            for p, k in retry_result.get("api_keys", {}).items():
                orig.setdefault("api_keys", {})[p] = k
                if p in orig.get("failed_providers", []):
                    orig["failed_providers"].remove(p)
                orig.get("errors", {}).pop(p, None)
                extra_keys += 1
                disp = Config.PROVIDER_REGISTRY.get(p, {}).get("display", p)
                print(_c(f"  ✓ {email} — {disp}: key saved", "92"), flush=True)

            # Update entries
            remaining = orig.get("failed_providers", [])
            if remaining:
                entries[idx] = (email, remaining)
                failures[email] = remaining
                remaining_names = ", ".join(
                    Config.PROVIDER_REGISTRY.get(p, {}).get("display", p) for p in remaining
                )
                print(_c(f"  ⚠ Masih gagal: {remaining_names}", "93"), flush=True)
            else:
                entries.pop(idx)
                failures.pop(email, None)
                print(_c(f"  ✓ {email} — semua provider resolved!", "1;92"), flush=True)

        # Save post-retry output
        if extra_keys > 0:
            ts2 = datetime.now().strftime("%Y%m%d-%H%M%S")
            out2 = output_dir / f"harvest-{ts2}-after-retry.txt"
            merged = list(result_map.values()) + [r for r in all_results if r.get("email") not in result_map]
            OutputWriter.save(merged, out2)
            print(_c(f"\n  Output retry disimpan → {out2}", "2"), flush=True)

    except (KeyboardInterrupt, EOFError):
        print(_c("\n  Retry dibatalkan.", "93"), flush=True)
    finally:
        # Restore original gate & mode
        _ci.interact_gate = _original_gate
        Config.INTERACTIVE_MODE = False

    return extra_keys


# ── Main ──────────────────────────────────────────────────────────────────────

async def main(args: argparse.Namespace) -> None:
    lock_file = Path(__file__).parent / "daemon.lock"
    if lock_file.exists():
        print(_c(f"  ✗ Lock file found: {lock_file}. Another instance running? Delete it if not.", "91"), flush=True)
        sys.exit(1)
    try:
        lock_file.write_text(str(os.getpid()))
    except Exception as e:
        print(_c(f"  ✗ Could not create lock file: {e}", "91"), flush=True)
        sys.exit(1)

    def _remove_lock():
        try:
            if lock_file.exists():
                lock_file.unlink()
        except Exception: pass
    atexit.register(_remove_lock)

    # Setup Emit callback → terminal log
    Emit.set_callback(emit_as_terminal_log)
    Config.INTERACTIVE_MODE = False # Force non-interactive for Phase 1

    # Suppress stderr noise
    sys.stderr = NullWriter()
    logging.getLogger().setLevel(logging.ERROR)

    proxy_url = args.proxy or os.getenv("HARVEST_PROXY") or os.getenv("BATCHER_PROXY_URL", "")
    proxy_mgr = ProxyManager(proxy_url)
    await proxy_mgr.initialize()

    os.environ["BATCHER_CAMOUFOX_HEADLESS"] = "true" if args.headless else "false"

    providers = validate_providers(args.providers)
    if not providers: sys.exit(1)

    accounts = load_accounts(args)
    if not accounts:
        print(_c("  ✗ No accounts loaded. Check your input file.", "91"), flush=True)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cp_mgr = CheckpointManager(output_dir)

    if args.resume:
        cp = cp_mgr.load()
        completed_emails = set(cp.get("completed", {}).keys())
        if completed_emails:
            before = len(accounts)
            accounts = [a for a in accounts if a["email"] not in completed_emails]
            skipped = before - len(accounts)
            if skipped:
                print(_c(f"  Resume: {skipped}/{before} done, {len(accounts)} remaining.", "96"), flush=True)
    else:
        cp_mgr.remove()

    is_rotating = len(proxy_mgr.proxies) > 1
    proxy_desc = f"yes ({len(proxy_mgr.proxies)} rotating)" if is_rotating else ("yes" if proxy_url else "no")

    print(_c("\n" + "═" * 62, "94"), flush=True)
    print(_c("  Bulk Harvester — Non-Interactive Mode", "1;94"), flush=True)
    print(_c("═" * 62, "94"), flush=True)
    print(f"  Accounts  : {len(accounts)}", flush=True)
    print(f"  Providers : {', '.join(providers)}", flush=True)
    print(f"  Concurrent: {args.concurrent}", flush=True)
    print(f"  Headless  : {args.headless}", flush=True)
    print(f"  Proxy     : {proxy_desc}", flush=True)
    print(_c("═" * 62, "94"), flush=True)
    print(flush=True)

    # ── Phase 1: Concurrent harvest ───────────────────────────────────────────
    all_results = await run_harvest_phase(
        accounts, providers, args.concurrent, proxy_mgr,
        args.timeout, cp_mgr, 
        google_login=args.google_login,
        dashboard_login=args.dashboard_login,
    )

    # Save initial output
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = output_dir / f"harvest-{ts}.txt"
    OutputWriter.save(all_results, output_path)

    total_keys = sum(len(r.get("api_keys", {})) for r in all_results)
    failed_count = sum(1 for r in all_results if r.get("failed_providers"))

    print(_c("\n" + "═" * 62, "94"), flush=True)
    print(_c(f"  Phase 1 selesai: {total_keys} keys, {failed_count} akun ada provider gagal", "1;94"), flush=True)
    print(_c(f"  Output: {output_path}", "2"), flush=True)
    print(_c("═" * 62, "94"), flush=True)

    # ── Phase 2: Post-run retry (jika ada yang gagal) ─────────────────────────
    if failed_count > 0:
        sys.stderr = _sys_stderr  # restore stderr untuk retry phase (butuh terminal)
        extra_keys = await run_retry_phase(
            all_results, accounts, proxy_mgr, args.concurrent, args.timeout, output_dir
        )
        total_keys += extra_keys

    # ── Final Proxy Sync: Aktifkan proxy untuk semua provider ─────────────────
    try:
        from core.browser import BrowserManager
        from harvest.dashboard import apply_proxy_to_all_providers
        manager, browser, page = await BrowserManager.launch(slot=0, email="system")
        await apply_proxy_to_all_providers(page)
        await manager.close()
    except Exception as _pe:
        print(f"  ⚠ Proxy Sync failed: {_pe}")

    # Final emit
    Emit.call({
        "type": "done", "total_accounts": len(accounts), "total_keys": total_keys,
        "output": str(output_path),
        "checkpoint": str(cp_mgr._path) if cp_mgr._path.exists() else "",
        "message": f"All done. {total_keys} keys harvested -> {output_path}",
    })


if __name__ == "__main__":
    parser = build_parser()
    args = parser.parse_args()

    if args.server:
        import server
        from aiohttp import web
        print(f"[run.py] Starting dashboard server...", flush=True)
        print(f"[run.py] URL: http://0.0.0.0:{args.port}", flush=True)
        web.run_app(server.create_app(), host="0.0.0.0", port=args.port, print=None)
        sys.exit(0)

    if not args.email and not args.file and not Path(args.accounts).exists():
        default = Path(__file__).parent / "accounts.json"
        if default.exists():
            args.accounts = str(default)
        else:
            parser.error("No accounts specified. Use --file, --accounts, --email/--password, or --server.")

    if args.email and not args.password:
        parser.error("--email requires --password")
    if args.password and not args.email:
        parser.error("--password requires --email")

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        print(_c("\n\nStopped.", "93"), flush=True)
