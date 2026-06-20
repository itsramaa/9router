"""Single-account harvest worker."""
from __future__ import annotations

import asyncio
import importlib

from harvest.base import set_current_email
from .browser import BrowserManager, cleanup_camoufox_temp
from .config import Config
from .emit import Emit
from .frames import FrameStreamer
from .context import _slot, _email, _page, _streamer, _emit_cb
from .interact import (
    interact_gate, 
    clear_interact_context,
    set_interact_context,
    ManualKeyIntercepted
)

# Sentinel: distinguishes user-cancel from provider returning empty string
_CANCELLED = object()


# Note: _interact_emit used to be here, but we now use Emit.call directly or a callback via Emit.


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
        force_dashboard_login: bool = False,
    ):
        self.slot = slot
        self.email = email
        self.password = password
        self.providers = providers
        self.proxy_url = proxy_url
        self.timeout_per_provider = timeout_per_provider
        self.force_google_login = force_google_login
        self.force_dashboard_login = force_dashboard_login
        self.result: dict = {"email": email, "slot": slot, "api_keys": {}, "errors": {}}

    async def run(self) -> dict:
        set_current_email(self.email)
        _slot.set(self.slot)
        _email.set(self.email)
        _emit_cb.set(Emit.call)

        Emit.progress("worker", "start", f"[Slot {self.slot}] Starting -> {self.email}")

        manager = browser = page = None
        streamer: FrameStreamer | None = None

        try:
            manager, browser, page = await BrowserManager.launch(slot=self.slot, email=self.email, proxy_url=self.proxy_url)
            streamer = FrameStreamer(page, self.slot)
            streamer.start()

            if self.force_google_login:
                Emit.progress("worker", "google_login", f"  [Slot {self.slot}] Pre-login Google mandated...")
                from harvest.google import handle_google_flow, handle_google_account_chooser
                from harvest.utils import safe_goto
                
                await safe_goto(page, "https://accounts.google.com/")
                await asyncio.sleep(2)
                
                if "accounts.google.com" in page.url and ("/signin" in page.url or "/identifier" in page.url):
                    if not await handle_google_flow(page, self.email, self.password):
                        Emit.error("worker", "Pre-login Google failed")
                else:
                    # Maybe already logged in or on chooser
                    await handle_google_account_chooser(page, self.email)
                
                await asyncio.sleep(2)

            if self.force_dashboard_login:
                Emit.progress("worker", "dashboard_login", f"  [Slot {self.slot}] Dashboard login mandated...")
                from harvest.dashboard import dashboard_login
                await dashboard_login(page)
                await asyncio.sleep(1)

            for pname in self.providers:
                reg = Config.PROVIDER_REGISTRY[pname]
                display, log_only = reg["display"], reg["log_only"]
                
                _page.set(page)
                _streamer.set(streamer)

                # Health check
                try: await page.evaluate("1")
                except Exception:
                    try:
                        page = await browser.new_page()
                        page.set_default_timeout(15000)
                        Emit.progress(pname, "page_reset", f"  ↺ Page reset for {display}")
                    except Exception as pe:
                        Emit.error(pname, f"Page dead: {pe}")
                        self.result["errors"][pname] = f"page_dead: {pe}"; continue

                while True:
                    key = ""
                    last_error = ""
                    timed_out = False
                    MAX_ATTEMPTS = 1
    
                    for attempt in range(MAX_ATTEMPTS):
                        if attempt > 0:
                            Emit.progress(pname, f"retry_{pname}", f"  ↻ {display}: retry {attempt}/{MAX_ATTEMPTS - 1}...")
                            await asyncio.sleep(3)
    
                        try:
                            mod = importlib.import_module(reg["module"])
                            fn = getattr(mod, reg["fn"])
                            Emit.progress(pname, f"harvesting_{pname}", f"  -> {display}" + (f" (attempt {attempt + 1})" if attempt > 0 else ""))
    
                            task = asyncio.create_task(fn(page, self.email, self.password, provider=pname))
                            BrowserManager.active_tasks[self.slot] = task
                            try:
                                # Prioritize provider-specific timeout from registry, fallback to default
                                _to = reg.get("timeout") or self.timeout_per_provider
                                if not _to or _to <= 0: _to = None
                                
                                key = await asyncio.wait_for(task, timeout=_to)
                            except ManualKeyIntercepted as mi:
                                if mi.key == "":
                                    # User explicitly skipped — treat as abort, don't re-prompt
                                    self.result["errors"][pname] = "skipped"
                                    Emit.progress(pname, f"skip_{pname}", f"  ✗ {display}: Skipped by user")
                                    key = _CANCELLED
                                    break
                                key = mi.key
                            except asyncio.CancelledError:
                                if task.cancelled():
                                    self.result["errors"][pname] = "skipped"
                                    Emit.progress(pname, f"skip_{pname}", f"  ✗ {display}: Skipped by user")
                                    key = _CANCELLED
                                    break
                                raise
                            finally:
                                BrowserManager.active_tasks.pop(self.slot, None)
    
                            if key: break
                            last_error = "no key returned"
    
                        except asyncio.TimeoutError:
                            timed_out = True
                            last_error = f"timeout after {self.timeout_per_provider}s"
                            Emit.error(pname, last_error)
                        except Exception as exc:
                            last_error = str(exc)
                            Emit.error(pname, f"{exc} (attempt {attempt + 1})")
                            if last_error.startswith("NO_RETRY:"): break
                    if key is _CANCELLED: break
                    if key:
                        if log_only: Emit.progress(pname, f"connected_{pname}", f"  ✓ {display}: Connected")
                        else:
                            self.result["api_keys"][pname] = key
                            Emit.api_key(pname, key)
                        break

                    # Non-interactive mode: skip gate entirely
                    if not Config.INTERACTIVE_MODE:
                        self.result["errors"][pname] = last_error or "no key"
                        if log_only:
                            # log_only provider (antigravity, xai, kilo_code, dll) tidak return API key
                            # → tidak masuk failed_providers, tidak ada yang bisa di-retry via clipboard
                            Emit.progress(pname, f"fail_{pname}", f"  ✗ {display}: {last_error or 'failed'}")
                        else:
                            # Non-log_only provider gagal → masuk daftar post-run retry
                            self.result.setdefault("failed_providers", []).append(pname)
                            Emit.progress(pname, f"fail_{pname}", f"  ✗ {display}: {last_error or 'failed'} (will retry later)")
                        break

                    # Interaction gate fallback (INTERACTIVE_MODE=True only)
                    try:
                        # Skip gate for systemic/timeout errors that manual intervention can't fix
                        systemic_errors = [
                            "timeout", "closed", "target", "navigation", 
                            "interrupted", "context", "connection", "rate limit"
                        ]
                        is_systemic = any(s in last_error.lower() for s in systemic_errors) if last_error else False
                        
                        if is_systemic:
                            Emit.log(f"  [skip_gate] Systemic error detected ({last_error}), skipping manual interaction.")
                        else:
                            res = await interact_gate(self.slot, page, display, self.email)
                            if res == "__retry__": continue
                            if res:
                                if res == "__continue__" and log_only:
                                    Emit.progress(pname, f"connected_{pname}", f"  ✓ {display}: Connected (manual)")
                                else:
                                    self.result["api_keys"][pname] = res
                                    Emit.api_key(pname, res, message=f"  ✓ {display} (manual): {res[:16]}...")
                                break
                    except (Exception, ManualKeyIntercepted) as ig_exc:
                        if isinstance(ig_exc, ManualKeyIntercepted) and ig_exc.key == "":
                             self.result["errors"][pname] = "skipped"
                             Emit.progress(pname, f"skip_{pname}", f"  ✗ {display}: Skipped by user")
                             break
                        Emit.log(f"  [interact_gate error] {ig_exc}")

                    self.result["errors"][pname] = last_error or "no key"
                    Emit.progress(pname, f"fail_{pname}", f"  ✗ {display}: {last_error or 'failed'}")
                    break

            Emit.result(self.result["api_keys"])
        except Exception as exc:
            Emit.error("_session", exc)
            self.result["errors"]["_session"] = str(exc)
        finally:
            clear_interact_context(self.slot)
            if streamer: await streamer.stop()
            Emit.progress("worker", "cleanup", f"Cleaning up slot {self.slot}...")
            if manager:
                try:
                    await manager.__aexit__(None, None, None)
                except Exception as _e:
                    import logging
                    logging.warning(f'Swallowed exception: {_e}')
            # Clean up Camoufox temp dirs after each browser session
            try:
                cleanup_camoufox_temp()
            except Exception as _e:
                import logging
                logging.warning(f'Swallowed exception: {_e}')

        return self.result
