"""Single-account harvest worker."""

from __future__ import annotations

import asyncio
import importlib
import logging

from harvest.base import set_current_email
from .browser import BrowserManager, cleanup_camoufox_temp
from .config import Config
from .emit import Emit
from .frames import FrameStreamer
from .context import _slot, _email, _page, _streamer, _emit_cb, _google_session_ok
from .interact import clear_interact_context, ManualKeyIntercepted

_CANCELLED = object()


class HarvestWorker:
    def __init__(
        self,
        slot: int,
        email: str,
        password: str,
        providers: list[str],
        proxy_url: str = "",
        timeout_per_provider: float = 500.0,
        force_google_login: bool = False,
    ):
        self.slot = slot
        self.email = email
        self.password = password
        self.providers = providers
        self.proxy_url = proxy_url
        self.timeout_per_provider = timeout_per_provider
        self.force_google_login = force_google_login
        self.result: dict = {"email": email, "slot": slot, "api_keys": {}, "errors": {}}

    async def run(self) -> dict:
        set_current_email(self.email)
        _slot.set(self.slot)
        _email.set(self.email)
        _emit_cb.set(Emit.call)
        # Reset Google session cache for this worker run.
        # Each worker has its own browser context, so previous login state is invalid.
        _google_session_ok.set(False)

        Emit.progress("worker", "start", f"[Slot {self.slot}] Starting -> {self.email}")

        manager = browser = page = None
        streamer: FrameStreamer | None = None

        try:
            manager, browser, page = await BrowserManager.launch(
                slot=self.slot, email=self.email, proxy_url=self.proxy_url
            )
            streamer = FrameStreamer(page, self.slot)
            streamer.start()

            if self.force_google_login:
                Emit.progress(
                    "worker", "google_login", f"  [Slot {self.slot}] Google login..."
                )
                from harvest.google import (
                    handle_google_flow,
                    handle_google_account_chooser,
                )
                from harvest.utils import safe_goto

                await safe_goto(page, "https://accounts.google.com/")
                await asyncio.sleep(2)
                if "accounts.google.com" in page.url and (
                    "/signin" in page.url or "/identifier" in page.url
                ):
                    if not await handle_google_flow(page, self.email, self.password):
                        Emit.error("worker", "Google login failed")
                else:
                    await handle_google_account_chooser(page, self.email)
                await asyncio.sleep(2)

            for pname in self.providers:
                reg = Config.PROVIDER_REGISTRY[pname]
                display = reg["display"]
                log_only = reg["log_only"]

                _page.set(page)
                _streamer.set(streamer)

                # Page health check
                try:
                    await page.evaluate("1")
                except Exception:
                    try:
                        page = await browser.new_page()
                        page.set_default_timeout(15000)
                        Emit.progress(
                            pname, "page_reset", f"  ↺ Page reset for {display}"
                        )
                    except Exception as pe:
                        Emit.error(pname, f"Page dead: {pe}")
                        self.result["errors"][pname] = f"page_dead: {pe}"
                        continue

                key = ""
                last_error = ""

                try:
                    mod = importlib.import_module(reg["module"])
                    fn = getattr(mod, reg["fn"])
                    Emit.progress(pname, f"harvesting_{pname}", f"  -> {display}")

                    task = asyncio.create_task(
                        fn(page, self.email, self.password, provider=pname)
                    )
                    BrowserManager.active_tasks[self.slot] = task
                    try:
                        _to = reg.get("timeout") or self.timeout_per_provider
                        if not _to or _to <= 0:
                            _to = None
                        key = await asyncio.wait_for(task, timeout=_to)
                    except ManualKeyIntercepted as mi:
                        if mi.key == "":
                            self.result["errors"][pname] = "skipped"
                            Emit.progress(
                                pname, f"skip_{pname}", f"  ✗ {display}: Skipped"
                            )
                            key = _CANCELLED
                        else:
                            key = mi.key
                    except asyncio.CancelledError:
                        self.result["errors"][pname] = "skipped"
                        Emit.progress(
                            pname, f"skip_{pname}", f"  ✗ {display}: Cancelled"
                        )
                        key = _CANCELLED
                    except asyncio.TimeoutError:
                        last_error = f"timeout after {self.timeout_per_provider}s"
                        Emit.error(pname, last_error)
                    except Exception as exc:
                        last_error = str(exc)
                        Emit.error(pname, str(exc))
                    finally:
                        BrowserManager.active_tasks.pop(self.slot, None)

                except Exception as exc:
                    last_error = str(exc)
                    Emit.error(pname, str(exc))

                if key is _CANCELLED:
                    continue

                if key:
                    if log_only:
                        Emit.progress(
                            pname, f"connected_{pname}", f"  ✓ {display}: Connected"
                        )
                    else:
                        self.result["api_keys"][pname] = key
                        Emit.api_key(pname, key)
                    continue

                # Failed — record error, mark for potential web retry
                self.result["errors"][pname] = last_error or "no key"
                if log_only:
                    Emit.progress(
                        pname,
                        f"fail_{pname}",
                        f"  ✗ {display}: {last_error or 'failed'}",
                    )
                else:
                    self.result.setdefault("failed_providers", []).append(pname)
                    Emit.progress(
                        pname,
                        f"fail_{pname}",
                        f"  ✗ {display}: {last_error or 'failed'}",
                    )

            Emit.result(self.result["api_keys"])

        except Exception as exc:
            Emit.error("_session", exc)
            self.result["errors"]["_session"] = str(exc)
        finally:
            clear_interact_context(self.slot)
            if streamer:
                await streamer.stop()
            if manager:
                try:
                    await manager.__aexit__(None, None, None)
                except Exception as _e:
                    logging.warning(f"Manager close error: {_e}")
            try:
                cleanup_camoufox_temp()
            except Exception as _e:
                logging.warning(f"Cleanup error: {_e}")

        return self.result
