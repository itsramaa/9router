"""HTTP route handlers for the dashboard server."""

from __future__ import annotations


import asyncio

import json

import logging

import os

import sys

import time

from pathlib import Path


from aiohttp import web


from .state import ServerState

from .ws import WebSocketManager

# AUDIT-003 fix: Import validation utilities
from core.validation import validate_proxy_url

MAX_RESULT_CONTENT_BYTES = 512 * 1024  # BUG-025: cap result file reads at 512KB


class ServerHandlers:

    def __init__(self, state: ServerState, ws_mgr: WebSocketManager):

        self.state = state

        self.ws_mgr = ws_mgr

        self.base_dir = Path(__file__).resolve().parent.parent

        self.dist_dir = self.base_dir / "dashboard" / "dist"

        self.outputs = self.base_dir / "outputs"

        self.backups = self.base_dir / "backups"

    async def handle_index(self, request: web.Request) -> web.Response:

        index_html = self.dist_dir / "index.html"

        if index_html.exists():

            return web.Response(
                text=index_html.read_text(encoding="utf-8"),
                content_type="text/html",
            )

        old_html = self.base_dir / "dashboard.html"

        if old_html.exists():

            return web.Response(
                text=old_html.read_text(encoding="utf-8"),
                content_type="text/html",
            )

        return web.Response(
            text="<h1>React build not found. Run npm run build inside dashboard/</h1>",
            content_type="text/html",
            status=404,
        )

    async def handle_accounts(self, request: web.Request) -> web.Response:

        from core.accounts import AccountLoader

        json_path = self.base_dir / "accounts.json"

        txt_path = self.base_dir / "accounts.txt"

        accounts = []

        if json_path.exists():

            accounts = AccountLoader.from_json(str(json_path))

        elif txt_path.exists():

            accounts = AccountLoader.from_txt(str(txt_path))

        # BUG-028 fix: strip passwords before returning to client

        safe = [
            {"email": a.get("email", ""), "tags": a.get("tags", [])} for a in accounts
        ]

        return web.json_response({"accounts": safe})

    async def handle_save_accounts(self, request: web.Request) -> web.Response:

        from core.accounts import AccountSaver

        try:

            body = await request.json()

        except Exception:

            return web.json_response(
                {"ok": False, "error": "Invalid JSON body"}, status=400
            )

        new_accounts = body.get("accounts")

        if not isinstance(new_accounts, list):

            return web.json_response(
                {"ok": False, "error": "accounts must be a list"}, status=400
            )

        json_path = self.base_dir / "accounts.json"

        try:

            AccountSaver.save_json(
                str(json_path), new_accounts, backup_dir=str(self.backups)
            )

        except Exception as e:

            return web.json_response(
                {"ok": False, "error": f"Failed to save accounts: {e}"}, status=500
            )

        return web.json_response(
            {
                "ok": True,
                "message": f"Saved {len(new_accounts)} accounts to accounts.json",
            }
        )

    async def handle_results(self, request: web.Request) -> web.Response:

        files = sorted(
            self.outputs.glob("harvest-*.txt"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )

        results = []

        for f in files[:10]:

            content = f.read_text(encoding="utf-8")

            # BUG-025 fix: cap content to prevent memory spike on large files

            if len(content.encode("utf-8")) > MAX_RESULT_CONTENT_BYTES:

                content = content[:MAX_RESULT_CONTENT_BYTES] + "\n... (truncated)"

            results.append(
                {
                    "name": f.name,
                    "path": str(f),
                    "size": f.stat().st_size,
                    "content": content,
                }
            )

        return web.json_response({"results": results})

    async def handle_progress(self, request: web.Request) -> web.Response:

        progress_file = self.outputs / "progress.json"

        if progress_file.exists():

            try:

                data = json.loads(progress_file.read_text(encoding="utf-8"))

                return web.json_response(data)

            except Exception as e:

                return web.json_response({"error": str(e)}, status=500)

        return web.json_response({"completed": {}, "total_keys": 0})

    async def handle_start(self, request: web.Request) -> web.Response:

        if self.state.proc and self.state.proc.returncode is None:

            return web.json_response({"ok": False, "error": "Already running"})

        self.state.cleanup_retry()  # Cleanup completed retries before starting new harvest

        try:

            body = await request.json()

        except Exception:

            body = {}

        concurrent = int(body.get("concurrent", 2))

        resume = bool(body.get("resume", False))

        proxy = str(body.get("proxy", "")).strip()

        raw_providers = body.get("providers", "all")

        if isinstance(raw_providers, list):

            providers = ",".join(str(p) for p in raw_providers)

        else:

            providers = str(raw_providers).strip()

        timeout = float(body.get("timeout", 500))

        accounts_file = str(body.get("accounts_file", "")).strip()

        display_mode = str(body.get("display_mode", "headless")).strip()

        _dm_map = {"headless": "true", "headed": "false", "virtual": "virtual"}

        headless_env = _dm_map.get(display_mode, "true")

        run_script = self.base_dir / "run.py"

        if not run_script.exists():

            return web.json_response({"ok": False, "error": "run.py not found"})

        # BUG-036 fix: validate accounts_file is within base_dir to prevent path injection

        if accounts_file:

            try:

                safe_path = (self.base_dir / Path(accounts_file).name).resolve()

                base_resolved = self.base_dir.resolve()

                if not str(safe_path).startswith(str(base_resolved)):

                    return web.json_response(
                        {"ok": False, "error": "Invalid accounts file path"}, status=400
                    )

                accounts_file = str(safe_path)

            except Exception:

                return web.json_response(
                    {"ok": False, "error": "Invalid accounts file path"}, status=400
                )

        if accounts_file and Path(accounts_file).exists():

            acc_arg = [
                "--file" if accounts_file.endswith(".txt") else "--accounts",
                accounts_file,
            ]

        elif (self.base_dir / "accounts.txt").exists():

            acc_arg = ["--file", str(self.base_dir / "accounts.txt")]

        else:

            acc_arg = ["--accounts", str(self.base_dir / "accounts.json")]

        cmd = [
            sys.executable,
            str(run_script),
            *acc_arg,
            "--concurrent",
            str(concurrent),
            "--providers",
            providers,
            "--timeout",
            str(timeout),
            "--output-dir",
            str(self.outputs),
        ]

        if resume:

            cmd.append("--resume")

        # AUDIT-003 fix: Validate proxy URL to prevent command injection
        if proxy:
            is_valid, error_msg = validate_proxy_url(proxy)
            if not is_valid:
                return web.json_response(
                    {"ok": False, "error": f"Invalid proxy URL: {error_msg}"},
                    status=400
                )

        if proxy:

            if (
                "\n" in proxy
                or "," in proxy
                or (
                    len(proxy) > 120
                    and not proxy.startswith(
                        ("http://", "https://", "socks5://", "socks4://")
                    )
                )
            ):

                temp_proxy_file = self.outputs / "temp-proxies.txt"

                try:

                    temp_proxy_file.write_text(proxy, encoding="utf-8", errors="ignore")

                    cmd += ["--proxy", str(temp_proxy_file)]

                except Exception:

                    cmd += ["--proxy", proxy]

            else:

                cmd += ["--proxy", proxy]

        env = os.environ.copy()

        env["PYTHONUNBUFFERED"] = "1"

        env["BATCHER_CAMOUFOX_HEADLESS"] = headless_env

        env["BATCHER_INTERACTIVE"] = "1"

        self.state.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd=str(self.base_dir),
            limit=4 * 1024 * 1024,
        )

        self.state.proc_stdin = self.state.proc.stdin

        # Cleanup temp proxy file if created
        if 'temp_proxy_file' in locals():
            try:
                temp_proxy_file.unlink(missing_ok=True)
            except Exception: pass

        self.state.proc_task = asyncio.create_task(
            self.ws_mgr.stream_proc(self.state.proc)
        )

        await self.ws_mgr.broadcast(
            {
                "type": "started",
                "pid": self.state.proc.pid,
                "message": f"Harvest started (concurrent={concurrent}, providers={providers})",
            }
        )

        return web.json_response({"ok": True, "pid": self.state.proc.pid})

    async def handle_stop(self, request: web.Request) -> web.Response:

        if self.state.proc and self.state.proc.returncode is None:

            try:

                self.state.proc.terminate()

            except Exception as _e:

                logging.warning(f"Swallowed exception: {_e}")

            try:

                await asyncio.wait_for(self.state.proc.wait(), timeout=5.0)

            except (asyncio.TimeoutError, Exception):

                pass

            if self.state.proc and self.state.proc.returncode is None:

                try:

                    self.state.proc.kill()

                    await asyncio.wait_for(self.state.proc.wait(), timeout=3.0)

                except (asyncio.TimeoutError, Exception) as _e:

                    logging.warning(f"Force kill failed: {_e}")

        if self.state.proc_task and not self.state.proc_task.done():

            self.state.proc_task.cancel()

            try:

                await asyncio.wait_for(
                    asyncio.shield(self.state.proc_task), timeout=2.0
                )

            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):

                pass

        self.state.proc_task = None

        self.state.proc_stdin = None

        # Terminate retry processes
        for proc in list(self.state.retry_procs):
            if proc.returncode is None:
                try:
                    proc.terminate()
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                except (asyncio.TimeoutError, Exception):
                    try:
                        proc.kill()
                        await asyncio.wait_for(proc.wait(), timeout=2.0)
                    except Exception: pass
        self.state.retry_procs.clear()
        for task in self.state.retry_tasks:
            if not task.done():
                task.cancel()
        self.state.retry_tasks.clear()

        lock_file = self.base_dir / "daemon.lock"

        try:

            if lock_file.exists():

                lock_file.unlink()

        except Exception:

            pass

        await self.ws_mgr.broadcast({"type": "stopped", "message": "Stopped by user"})

        return web.json_response({"ok": True})

    async def handle_interact(self, request: web.Request) -> web.Response:

        try:

            body = await request.json()

        except Exception:

            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

        slot = body.get("slot")

        action = body.get("action", "")

        if slot is None or not action:

            return web.json_response(
                {"ok": False, "error": "slot and action required"}, status=400
            )

        # BUG-023 fix: strip newlines to prevent stdin command injection

        action = str(action).replace("\n", "").replace("\r", "").strip()

        if not action:

            return web.json_response(
                {"ok": False, "error": "Invalid action"}, status=400
            )

        if self.state.proc_stdin and not self.state.proc_stdin.is_closing():

            try:

                line = f"interact {slot} {action}\n"

                self.state.proc_stdin.write(line.encode())

                await self.state.proc_stdin.drain()

            except Exception as e:

                return web.json_response({"ok": False, "error": str(e)}, status=500)

        else:

            print(
                f"[server] handle_interact: proc_stdin not available (proc_stdin={self.state.proc_stdin!r})",
                flush=True,
            )

            return web.json_response(
                {"ok": False, "error": "Harvest not running or stdin unavailable"},
                status=503,
            )

        return web.json_response({"ok": True})

    async def _backup(self) -> dict | None:

        progress_file = self.outputs / "progress.json"

        if not progress_file.exists():

            return None

        try:

            data = json.loads(progress_file.read_text(encoding="utf-8"))

        except Exception:

            data = {"completed": {}, "total_keys": 0}

        harvest_files = {}

        for f in sorted(
            self.outputs.glob("harvest-*.txt"), key=lambda f: f.stat().st_mtime
        ):

            try:

                harvest_files[f.name] = f.read_text(encoding="utf-8")

            except Exception as _e:

                logging.warning(f"Swallowed exception: {_e}")

        snapshot = {
            "progress": data,
            "harvest_files": harvest_files,
        }

        ts = time.strftime("%Y%m%d-%H%M%S")

        backup_dir = self.backups / f"history-{ts}"

        backup_dir.mkdir(parents=True, exist_ok=True)

        (backup_dir / "snapshot.json").write_text(
            json.dumps(snapshot, indent=2), encoding="utf-8"
        )

        for name, content in harvest_files.items():

            (backup_dir / name).write_text(content, encoding="utf-8")

        return snapshot

    async def handle_reset(self, request: web.Request) -> web.Response:

        await self._backup()

        progress_file = self.outputs / "progress.json"

        if progress_file.exists():

            try:

                progress_file.unlink()

            except Exception as _e:

                logging.warning(f"Swallowed exception: {_e}")

        for f in self.outputs.glob("harvest-*.txt"):

            try:

                f.unlink()

            except Exception as _e:

                logging.warning(f"Swallowed exception: {_e}")

        lock_file = self.base_dir / "daemon.lock"

        try:

            if lock_file.exists():

                lock_file.unlink()

        except Exception:

            pass

        await self.ws_mgr.broadcast({"type": "reset"})

        return web.json_response({"ok": True})

    async def handle_list_backups(self, request: web.Request) -> web.Response:

        items = []

        for d in (
            sorted(self.backups.iterdir(), reverse=True)
            if self.backups.exists()
            else []
        ):

            if d.is_dir():

                snapshot_file = d / "snapshot.json"

                if snapshot_file.exists():

                    try:

                        meta = json.loads(snapshot_file.read_text(encoding="utf-8"))

                        total_keys = meta.get("progress", {}).get("total_keys", 0)

                    except Exception:

                        total_keys = 0

                    items.append(
                        {
                            "name": d.name,
                            "path": str(d),
                            "total_keys": total_keys,
                        }
                    )

        return web.json_response({"backups": items})

    async def handle_simulate(self, request: web.Request) -> web.Response:

        if self.state.proc and self.state.proc.returncode is None:

            return web.json_response({"ok": False, "error": "Already running"})

        self.state.cleanup_retry()

        try:

            body = await request.json()

        except Exception:

            body = {}

        concurrent = int(body.get("concurrent", 2))

        providers_raw = body.get("providers", "all")

        if isinstance(providers_raw, list):

            providers = ",".join(str(p) for p in providers_raw)

        else:

            providers = str(providers_raw).strip()

        resume = bool(body.get("resume", False))

        run_script = self.base_dir / "run.py"

        if not run_script.exists():

            return web.json_response({"ok": False, "error": "run.py not found"})

        acc_file = self.base_dir / "accounts.json"

        if not acc_file.exists():

            return web.json_response({"ok": False, "error": "accounts.json not found"})

        cmd = [
            sys.executable,
            str(run_script),
            "--accounts",
            str(acc_file),
            "--providers",
            providers,
            "--concurrent",
            str(concurrent),
            "--output-dir",
            str(self.outputs),
            "--simulate",
        ]

        if resume:

            cmd.append("--resume")

        env = os.environ.copy()

        env["PYTHONUNBUFFERED"] = "1"

        env["BATCHER_INTERACTIVE"] = "1"

        self.state.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd=str(self.base_dir),
        )

        self.state.proc_stdin = self.state.proc.stdin

        self.state.proc_task = asyncio.create_task(
            self.ws_mgr.stream_proc(self.state.proc)
        )

        await self.ws_mgr.broadcast(
            {
                "type": "started",
                "pid": self.state.proc.pid,
                "message": f"Simulation started (concurrent={concurrent}, providers={providers})",
            }
        )

        return web.json_response(
            {"ok": True, "pid": self.state.proc.pid, "mode": "simulate"}
        )

    async def handle_restore_backup(self, request: web.Request) -> web.Response:

        try:

            body = await request.json()

        except Exception:

            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

        backup_name = body.get("name", "")

        # BUG-024 fix: reject path traversal in backup_name

        if (
            not backup_name
            or ".." in backup_name
            or "/" in backup_name
            or "\\" in backup_name
        ):

            return web.json_response(
                {"ok": False, "error": "Invalid backup name"}, status=400
            )

        backup_dir = self.backups / backup_name

        snapshot_file = backup_dir / "snapshot.json"

        if not snapshot_file.exists():

            return web.json_response(
                {"ok": False, "error": "Backup not found"}, status=404
            )

        try:

            snapshot = json.loads(snapshot_file.read_text(encoding="utf-8"))

        except Exception as e:

            return web.json_response({"ok": False, "error": str(e)}, status=500)

        self.outputs.mkdir(parents=True, exist_ok=True)

        progress_file = self.outputs / "progress.json"

        progress_file.write_text(
            json.dumps(snapshot.get("progress", {}), indent=2), encoding="utf-8"
        )

        harvest_files = snapshot.get("harvest_files", {})

        for name, content in harvest_files.items():

            # BUG-024 fix: strip path components from harvest file names

            safe_name = Path(name).name

            if not safe_name or ".." in safe_name:

                continue

            (self.outputs / safe_name).write_text(content, encoding="utf-8")

        await self.ws_mgr.broadcast({"type": "reset"})

        return web.json_response({"ok": True})

    async def handle_retry_slot(self, request: web.Request) -> web.Response:
        """Retry a failed slot by restarting harvest for that specific account."""

        try:

            body = await request.json()

        except Exception:

            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

        slot = body.get("slot")

        if slot is None:

            return web.json_response(
                {"ok": False, "error": "slot is required"}, status=400
            )

        # Read accounts to find the one for this slot

        from core.accounts import AccountLoader

        json_path = self.base_dir / "accounts.json"

        txt_path = self.base_dir / "accounts.txt"

        accounts = []

        if json_path.exists():

            accounts = AccountLoader.from_json(str(json_path))

        elif txt_path.exists():

            accounts = AccountLoader.from_txt(str(txt_path))

        # Slot is 1-indexed, find matching account

        if slot < 1 or slot > len(accounts):

            return web.json_response(
                {"ok": False, "error": f"Invalid slot: {slot}"}, status=400
            )

        account = accounts[slot - 1]

        email = account.get("email", "")

        password = account.get("password", "")

        if not email or not password:

            return web.json_response(
                {"ok": False, "error": "Account email/password missing"}, status=400
            )

        # If main harvest is running, send abort to that slot first

        if self.state.proc and self.state.proc.returncode is None:

            if self.state.proc_stdin and not self.state.proc_stdin.is_closing():

                try:

                    line = f"interact {slot} abort\n"

                    self.state.proc_stdin.write(line.encode())

                    await self.state.proc_stdin.drain()

                    await asyncio.sleep(1.0)  # Give worker time to abort

                except Exception as e:

                    logging.warning(f"Retry abort failed: {e}")

        # Spawn new subprocess for this specific account

        run_script = self.base_dir / "run.py"

        if not run_script.exists():

            return web.json_response({"ok": False, "error": "run.py not found"})

        # Use providers from request body or default to all
        
        from core.config import Config
        
        providers_raw = body.get("providers")
        if providers_raw:
            # User specified specific providers to retry
            if isinstance(providers_raw, list):
                providers = ",".join(str(p) for p in providers_raw)
            else:
                providers = str(providers_raw).strip()
        else:
            # Default: retry all providers
            providers = (
                ",".join(Config.ALL_PROVIDERS)
                if hasattr(Config, "ALL_PROVIDERS")
                else "all"
            )

        cmd = [
            sys.executable,
            str(run_script),
            "--email",
            email,
            "--password",
            password,
            "--providers",
            providers,
            "--concurrent",
            "1",
            "--output-dir",
            str(self.outputs),
        ]

        env = os.environ.copy()

        env["PYTHONUNBUFFERED"] = "1"

        env["BATCHER_CAMOUFOX_HEADLESS"] = "true"

        env["BATCHER_INTERACTIVE"] = "1"

        try:

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
                cwd=str(self.base_dir),
            )

            # Track this retry process

            self.state.retry_procs.append(proc)

            task = asyncio.create_task(self._stream_retry_proc(proc, slot, email))

            self.state.retry_tasks.append(task)

            await self.ws_mgr.broadcast(
                {
                    "type": "retry_started",
                    "slot": slot,
                    "email": email,
                    "pid": proc.pid,
                    "message": f"Retrying slot {slot} for {email}",
                }
            )

            return web.json_response({"ok": True, "pid": proc.pid})

        except Exception as e:

            return web.json_response(
                {"ok": False, "error": f"Failed to start retry: {e}"}, status=500
            )

    async def _stream_retry_proc(
        self, proc: asyncio.subprocess.Process, slot: int, email: str
    ) -> None:
        """Stream stdout from retry process and broadcast to WebSocket."""

        try:

            while True:

                line = await proc.stdout.readline()

                if not line:

                    break

                raw = line.decode("utf-8", errors="replace").strip()

                if not raw:

                    continue

                try:

                    data = json.loads(raw)

                    # Ensure slot info is present

                    if "slot" not in data:

                        data["slot"] = slot

                    if "email" not in data:

                        data["email"] = email

                    await self.ws_mgr.broadcast(data)

                except json.JSONDecodeError:

                    # Plain text log

                    await self.ws_mgr.broadcast(
                        {
                            "type": "log",
                            "slot": slot,
                            "message": raw,
                        }
                    )

        except Exception as e:

            logging.warning(f"Retry stream error: {e}")

        finally:

            await proc.wait()

            await self.ws_mgr.broadcast(
                {
                    "type": "retry_done",
                    "slot": slot,
                    "email": email,
                    "returncode": proc.returncode,
                    "message": f"Retry finished for slot {slot}",
                }
            )

            # Cleanup

            if proc in self.state.retry_procs:

                self.state.retry_procs.remove(proc)

    async def handle_bulk_delete(self, request: web.Request) -> web.Response:
        """Bulk delete accounts by IDs."""

        try:

            body = await request.json()

        except Exception:

            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

        ids = body.get("ids", [])

        if not ids or not isinstance(ids, list):

            return web.json_response(
                {"ok": False, "error": "ids must be a non-empty list"}, status=400
            )

        # Read current accounts

        from core.accounts import AccountLoader, AccountSaver

        json_path = self.base_dir / "accounts.json"

        accounts = []

        if json_path.exists():

            accounts = AccountLoader.from_json(str(json_path))

        # Filter out accounts by index (IDs are 1-based in this context)

        remaining = []

        deleted = 0

        for i, acc in enumerate(accounts, start=1):

            if i in ids:

                deleted += 1

            else:

                remaining.append(acc)

        # Save remaining accounts

        try:

            AccountSaver.save_json(
                str(json_path), remaining, backup_dir=str(self.backups)
            )

        except Exception as e:

            return web.json_response(
                {"ok": False, "error": f"Failed to save: {e}"}, status=500
            )

        return web.json_response({"ok": True, "deleted": deleted})

    async def handle_bulk_harvest(self, request: web.Request) -> web.Response:
        """Start harvest for selected accounts only."""

        if self.state.proc and self.state.proc.returncode is None:

            return web.json_response({"ok": False, "error": "Already running"})

        self.state.cleanup_retry()

        try:

            body = await request.json()

        except Exception:

            return web.json_response({"ok": False, "error": "Invalid JSON"}, status=400)

        emails = body.get("emails", [])

        if not emails or not isinstance(emails, list):

            return web.json_response(
                {"ok": False, "error": "emails must be a non-empty list"}, status=400
            )

        # Read all accounts and filter by selected emails

        from core.accounts import AccountLoader

        json_path = self.base_dir / "accounts.json"

        accounts = []

        if json_path.exists():

            accounts = AccountLoader.from_json(str(json_path))

        selected = [a for a in accounts if a.get("email") in emails]

        if not selected:

            return web.json_response(
                {"ok": False, "error": "No matching accounts found"}, status=400
            )

        # Write temporary accounts file

        temp_accounts = self.outputs / "bulk-harvest-accounts.json"

        try:

            import json as json_mod

            temp_accounts.write_text(
                json_mod.dumps(selected, indent=2), encoding="utf-8"
            )

        except Exception as e:

            return web.json_response(
                {"ok": False, "error": f"Failed to write temp file: {e}"}, status=500
            )

        # Build command

        run_script = self.base_dir / "run.py"

        if not run_script.exists():

            return web.json_response({"ok": False, "error": "run.py not found"})

        providers_raw = body.get("providers", "all")

        if isinstance(providers_raw, list):

            providers = ",".join(str(p) for p in providers_raw)

        else:

            providers = str(providers_raw).strip()

        concurrent = int(body.get("concurrent", 2))

        cmd = [
            sys.executable,
            str(run_script),
            "--accounts",
            str(temp_accounts),
            "--providers",
            providers,
            "--concurrent",
            str(concurrent),
            "--output-dir",
            str(self.outputs),
        ]

        env = os.environ.copy()

        env["PYTHONUNBUFFERED"] = "1"

        env["BATCHER_CAMOUFOX_HEADLESS"] = "true"

        env["BATCHER_INTERACTIVE"] = "1"

        self.state.proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd=str(self.base_dir),
        )

        self.state.proc_stdin = self.state.proc.stdin

        # Cleanup temp accounts file
        try:
            temp_accounts.unlink(missing_ok=True)
        except Exception: pass

        self.state.proc_task = asyncio.create_task(
            self.ws_mgr.stream_proc(self.state.proc)
        )

        await self.ws_mgr.broadcast(
            {
                "type": "started",
                "pid": self.state.proc.pid,
                "message": f"Bulk harvest started for {len(selected)} accounts",
            }
        )

        return web.json_response({"ok": True, "pid": self.state.proc.pid})
