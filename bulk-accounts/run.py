#!/usr/bin/env python3


"""


run.py — Bulk API Key Harvester Entry Point


============================================


Spawned as a subprocess by the aiohttp dashboard server (srv/handlers.py).


Emits JSON-lines to stdout; ws.py forwards them to the WebSocket client.


When BATCHER_INTERACTIVE=1, enables the stdin reader so interact actions work.


"""

from __future__ import annotations


import argparse


import asyncio


import atexit


import logging


import os


import random


import sys


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


from core.worker import HarvestWorker


class _NullWriter:
    """Discards all writes — suppresses stderr noise from libraries."""

    def write(self, _data) -> None:
        pass

    def flush(self) -> None:
        pass


def build_parser() -> argparse.ArgumentParser:

    p = argparse.ArgumentParser(
        prog="run.py",
        description="Bulk API Key Harvester",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    src = p.add_argument_group("Account Sources (pick one)")

    src.add_argument(
        "--file",
        "-f",
        metavar="FILE.txt",
        help="Text file with email:password per line",
    )

    src.add_argument(
        "--accounts",
        "-a",
        metavar="FILE.json",
        default="accounts.json",
        help="JSON file [{email, password}, ...] (default: accounts.json)",
    )

    src.add_argument("--email", "-e", metavar="EMAIL")

    src.add_argument("--password", "-p", metavar="PASSWORD")

    cfg = p.add_argument_group("Settings")

    cfg.add_argument(
        "--concurrent",
        "-c",
        type=int,
        default=1,
        metavar="N",
        help="Concurrent browser sessions (default: 1)",
    )

    cfg.add_argument(
        "--proxy",
        metavar="URL",
        default="",
        help="Proxy URL e.g. http://user:pass@host:port",
    )

    cfg.add_argument(
        "--providers",
        default="all",
        metavar="LIST",
        help="Comma-separated providers or 'all' (default: all). Options: "
        + ", ".join(Config.ALL_PROVIDERS),
    )

    cfg.add_argument(
        "--resume",
        "-r",
        action="store_true",
        default=False,
        help="Skip already-completed accounts",
    )

    cfg.add_argument(
        "--timeout",
        type=float,
        default=500.0,
        metavar="SECONDS",
        help="Timeout per provider per account (default: 500)",
    )

    cfg.add_argument("--output-dir", default="outputs", metavar="DIR")

    cfg.add_argument(
        "--simulate",
        "-s",
        action="store_true",
        default=False,
        help="Simulate harvest (no real browsers, random keys)",
    )

    return p


async def run_harvest(
    accounts: list[dict],
    providers: list[str],
    concurrent: int,
    proxy_mgr: ProxyManager,
    timeout: float,
    cp_mgr: CheckpointManager,
) -> list[dict]:
    """Run all accounts concurrently. Emits JSON progress to stdout."""

    slot_queue: asyncio.Queue[int] = asyncio.Queue()

    for i in range(concurrent):

        slot_queue.put_nowait(i + 1)

    semaphore = asyncio.Semaphore(concurrent)

    all_results: list[dict] = []

    async def run_one(account: dict) -> dict:

        async with semaphore:

            await asyncio.sleep(random.uniform(0.5, 2.0))

            slot = await slot_queue.get()

            try:

                proxy = await proxy_mgr.get_next_proxy()

                worker = HarvestWorker(
                    slot=slot,
                    email=account["email"],
                    password=account["password"],
                    providers=providers,
                    proxy_url=proxy,
                    timeout_per_provider=timeout,
                )

                result = await worker.run()

                try:

                    async with cp_mgr.lock:

                        cp_mgr.data["completed"][account["email"]] = {
                            "api_keys": result.get("api_keys", {}),
                            "errors": result.get("errors", {}),
                            "slot": slot,
                            "timestamp": datetime.now().isoformat(),
                        }

                        cp_mgr.data["total_keys"] = sum(
                            len(v.get("api_keys", {}))
                            for v in cp_mgr.data["completed"].values()
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

            all_results.append(
                {"email": "unknown", "api_keys": {}, "errors": {"_exception": str(r)}}
            )

        else:

            all_results.append(r)

    return all_results


async def read_stdin_commands() -> None:
    """


    Read 'interact <slot> <action>' lines from stdin and dispatch to InteractMode.


    Only started when BATCHER_INTERACTIVE=1 (set by srv/handlers.py).


    OS-compatible: uses thread executor on Windows (ProactorEventLoop does not


    reliably support connect_read_pipe for piped stdin), asyncio pipe on Unix.


    """

    from core.interact import InteractMode

    def _dispatch_line(line: str) -> None:

        parts = line.strip().split(" ", 2)

        if len(parts) >= 3 and parts[0] == "interact":

            try:

                InteractMode.queue_action(int(parts[1]), parts[2])

            except (ValueError, Exception) as e:

                print(f"[stdin] Bad interact line: {line!r} — {e}", flush=True)

    if sys.platform == "win32":

        # Windows: connect_read_pipe unreliable for piped stdin — use thread executor

        loop = asyncio.get_event_loop()

        try:

            while True:

                line = await loop.run_in_executor(None, sys.stdin.readline)

                if not line:

                    break

                _dispatch_line(line)

        except Exception as e:

            print(f"[stdin] Windows stdin reader stopped: {e}", flush=True)

    else:

        # Unix/macOS: use asyncio native pipe reader

        loop = asyncio.get_event_loop()

        reader = asyncio.StreamReader()

        protocol = asyncio.StreamReaderProtocol(reader)

        try:

            await loop.connect_read_pipe(lambda: protocol, sys.stdin.buffer)

        except Exception as e:

            print(f"[stdin] Could not attach stdin reader: {e}", flush=True)

            return

        while True:

            try:

                line_bytes = await reader.readline()

            except Exception:

                break

            if not line_bytes:

                break

            _dispatch_line(line_bytes.decode("utf-8", errors="replace"))


async def main(args: argparse.Namespace) -> None:

    # ── Lock file: stale-PID aware ────────────────────────────────────────────

    lock_file = Path(__file__).parent / "daemon.lock"

    # BUG-026 fix: use O_EXCL for atomic lock file creation to prevent TOCTOU race

    def _check_stale_pid(pid_file):
        """Return True if the pid in the file is no longer running."""

        try:

            old_pid = int(pid_file.read_text().strip())

            if os.name == "nt":

                import ctypes, ctypes.wintypes

                handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, old_pid)

                if not handle:

                    return True

                code = ctypes.wintypes.DWORD()

                ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))

                ctypes.windll.kernel32.CloseHandle(handle)

                return code.value != 259  # 259 = STILL_ACTIVE

            else:

                os.kill(old_pid, 0)

                return False

        except (ValueError, OSError):

            return True

    try:

        _o_flags = (
            os.O_CREAT
            | os.O_EXCL
            | os.O_WRONLY
            | (os.O_BINARY if os.name == "nt" else 0)
        )

        fd = os.open(str(lock_file), _o_flags)

        os.write(fd, str(os.getpid()).encode())

        os.close(fd)

    except FileExistsError:

        if _check_stale_pid(lock_file):

            print(f"  ? Removing stale lock file (pid no longer running).", flush=True)

            try:

                lock_file.unlink()

            except Exception:

                pass

            # Retry atomic creation after stale removal

            try:

                fd = os.open(str(lock_file), _o_flags)

                os.write(fd, str(os.getpid()).encode())

                os.close(fd)

            except Exception as e:

                print(f"  ? Could not create lock file: {e}", flush=True)

                sys.exit(1)

        else:

            print(
                f"  ? Lock file found: {lock_file}. Another instance running?",
                flush=True,
            )

            sys.exit(1)

    except Exception as e:

        print(f"  ? Could not create lock file: {e}", flush=True)

        sys.exit(1)

    def _remove_lock():

        try:

            if lock_file.exists():

                lock_file.unlink()

        except Exception:

            pass

    atexit.register(_remove_lock)

    # ── Setup ─────────────────────────────────────────────────────────────────

    interactive = os.getenv("BATCHER_INTERACTIVE", "0") == "1"

    Config.INTERACTIVE_MODE = interactive

    sys.stderr = _NullWriter()

    logging.getLogger().setLevel(logging.ERROR)

    providers = validate_providers(args.providers)

    if not providers:

        sys.exit(1)

    accounts = load_accounts(args)

    if not accounts:

        print("  ✗ No accounts loaded.", flush=True)

        sys.exit(1)

    output_dir = Path(args.output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)

    Emit.call(
        {
            "type": "log",
            "message": f"Accounts: {len(accounts)} | Providers: {', '.join(providers)} | Concurrent: {args.concurrent} | Simulate: {args.simulate}",
        }
    )

    # ── Simulation mode ───────────────────────────────────────────────────────

    if args.simulate:

        from core.simulate import run_simulated_harvest

        await run_simulated_harvest(accounts, providers, args.concurrent, output_dir)

        try:

            lock_file.unlink()

        except Exception:

            pass

        return

    # ── Real harvest setup ───────────────────────────────────────────────────

    proxy_url = (
        args.proxy or os.getenv("HARVEST_PROXY") or os.getenv("BATCHER_PROXY_URL", "")
    )

    proxy_mgr = ProxyManager(proxy_url)

    await proxy_mgr.initialize()

    os.environ["BATCHER_CAMOUFOX_HEADLESS"] = os.environ.get(
        "BATCHER_CAMOUFOX_HEADLESS", "true"
    )

    cp_mgr = CheckpointManager(output_dir)

    if args.resume:

        cp = cp_mgr.load()

        completed = set(cp.get("completed", {}).keys())

        if completed:

            before = len(accounts)

            accounts = [a for a in accounts if a["email"] not in completed]

            Emit.call(
                {
                    "type": "log",
                    "message": f"Resume: {before - len(accounts)} done, {len(accounts)} remaining.",
                }
            )

    else:

        cp_mgr.remove()

    # ── Start stdin reader alongside harvest when interactive ─────────────────

    if interactive:

        stdin_task = asyncio.create_task(read_stdin_commands())

    else:

        stdin_task = None

    # ── Harvest ───────────────────────────────────────────────────────────────

    try:

        all_results = await run_harvest(
            accounts, providers, args.concurrent, proxy_mgr, args.timeout, cp_mgr
        )

    finally:

        if stdin_task and not stdin_task.done():

            stdin_task.cancel()

            try:

                await stdin_task

            except (asyncio.CancelledError, Exception):

                pass

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")

    output_path = output_dir / f"harvest-{ts}.txt"

    OutputWriter.save(all_results, output_path)

    total_keys = sum(len(r.get("api_keys", {})) for r in all_results)

    Emit.call(
        {
            "type": "done",
            "total_accounts": len(accounts),
            "total_keys": total_keys,
            "output": str(output_path),
            "message": f"Done. {total_keys} keys harvested → {output_path}",
        }
    )


if __name__ == "__main__":

    parser = build_parser()

    args = parser.parse_args()

    if not args.email and not args.file and not Path(args.accounts).exists():

        default = Path(__file__).parent / "accounts.json"

        if default.exists():

            args.accounts = str(default)

        else:

            parser.error("No accounts specified.")

    if args.email and not args.password:

        parser.error("--email requires --password")

    if args.password and not args.email:

        parser.error("--password requires --email")

    # Windows: set ProactorEventLoop so asyncio.create_subprocess_exec works

    if sys.platform == "win32":

        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    try:

        asyncio.run(main(args))

    except KeyboardInterrupt:

        print("\nStopped.", flush=True)
