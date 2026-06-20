"""Browser launcher & stdin skip/interact listener."""

from __future__ import annotations

import asyncio
import glob
import logging
import os
import shutil
import sys
import tempfile
import threading
from typing import Any
from urllib.parse import urlparse


def _queue_interact(slot: int, action: str) -> None:
    from .interact import InteractMode

    InteractMode.queue_action(slot, action)


def cleanup_camoufox_temp() -> None:
    """
    Delete temporary directories created by Camoufox/Playwright after each session.
    These accumulate in the system temp dir with patterns like playwright_*, camoufox_*, moz_*
    """
    tmp = tempfile.gettempdir()
    patterns = [
        "playwright*",
        "camoufox*",
        "moz-screenshot*",
        "rust_mozprofile*",
    ]
    for pat in patterns:
        for path in glob.glob(os.path.join(tmp, pat)):
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
            except Exception as _e:
                logging.warning(f"Swallowed exception: {_e}")


class BrowserManager:
    active_tasks: dict[int, asyncio.Task] = {}

    @classmethod
    def start_stdin_listener(cls, loop: asyncio.AbstractEventLoop) -> None:
        def worker():
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if not parts:
                    continue
                cmd = parts[0]
                try:
                    # Single-key shortcuts (default to slot 1 if not specified)
                    if cmd in ("s", "skip"):
                        target_slot = int(parts[1]) if len(parts) >= 2 else 1

                        def cancel_task():
                            task = cls.active_tasks.get(target_slot)
                            if task and not task.done():
                                task.cancel()

                        loop.call_soon_threadsafe(cancel_task)
                        # Also send skip to interact mode if applicable
                        loop.call_soon_threadsafe(_queue_interact, target_slot, "skip")
                    elif cmd in ("c", "continue"):
                        target_slot = int(parts[1]) if len(parts) >= 2 else 1
                        loop.call_soon_threadsafe(
                            _queue_interact, target_slot, "continue"
                        )
                    elif cmd in ("r", "retry"):
                        target_slot = int(parts[1]) if len(parts) >= 2 else 1
                        loop.call_soon_threadsafe(_queue_interact, target_slot, "retry")
                    elif cmd == "interact" and len(parts) >= 3:
                        target_slot = int(parts[1])
                        action_kind = parts[2]
                        if action_kind in ("continue", "abort", "skip", "retry"):
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, action_kind
                            )
                        elif action_kind == "click" and len(parts) >= 5:
                            x, y = parts[3], parts[4]
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, f"click:{x}:{y}"
                            )
                        elif action_kind == "type" and len(parts) >= 4:
                            text_b64 = parts[3]
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, f"type:{text_b64}"
                            )
                        elif action_kind == "scroll" and len(parts) >= 5:
                            dx, dy = parts[3], parts[4]
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, f"scroll:{dx}:{dy}"
                            )
                        elif action_kind == "back":
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, "back"
                            )
                        elif action_kind == "reload":
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, "reload"
                            )
                        elif action_kind == "goto" and len(parts) >= 4:
                            url = parts[3]
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, f"goto:{url}"
                            )
                        elif action_kind == "key" and len(parts) >= 4:
                            key_combo = parts[3]
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, f"key:{key_combo}"
                            )
                        elif action_kind.startswith("tab:"):
                            loop.call_soon_threadsafe(
                                _queue_interact, target_slot, action_kind
                            )
                except Exception as _e:
                    logging.warning(f"Swallowed exception: {_e}")

        threading.Thread(target=worker, daemon=True).start()

    @staticmethod
    async def launch(slot: int = 0, email: str = "", proxy_url: str = "") -> tuple[Any, Any, Any]:
        from camoufox.async_api import AsyncCamoufox
        from browserforge.fingerprints import Screen

        _headless_env = os.getenv("BATCHER_CAMOUFOX_HEADLESS", "true").lower()
        if _headless_env == "true":
            _headless_val: Any = True
        else:
            # headless=false requested — use visible window
            # On Linux/WSLg: use "virtual" only if no display available
            # On Windows/Mac: always use False (native display)
            if (
                sys.platform.startswith("linux")
                and not os.environ.get("DISPLAY")
                and not os.environ.get("WAYLAND_DISPLAY")
            ):
                _headless_val = "virtual"  # Xvfb fallback, Linux-only
            else:
                _headless_val = False

        kwargs: dict[str, Any] = {
            "headless": _headless_val,
            "block_webrtc": True,
            "humanize": False,
            "screen": Screen(max_width=1366, max_height=768),
            "window": (1366, 768),
            "firefox_user_prefs": {
                "widget.windows.window_occlusion_tracking.enabled": False,
                "dom.min_background_timeout_value": 10,
                "dom.timeout.enable_budget_timer_fallback": False,
                "dom.suspend_inactive.enabled": False,
                "network.http.throttle.enable": False,
            },
        }

        if proxy_url:
            parsed = urlparse(proxy_url)
            proxy_cfg: dict[str, Any] = {
                "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
            }
            if parsed.username:
                proxy_cfg["username"] = parsed.username
            if parsed.password:
                proxy_cfg["password"] = parsed.password
            kwargs["proxy"] = proxy_cfg
            kwargs["geoip"] = True

        manager = AsyncCamoufox(**kwargs)
        browser = await manager.__aenter__()

        try:
            page = await browser.new_page()
        except Exception:
            await manager.__aexit__(None, None, None)
            raise

        try:
            await page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        except Exception as _e:
            logging.warning(f"Swallowed exception: {_e}")

        page.set_default_timeout(20000)
        try:
            await page.set_viewport_size({"width": 1366, "height": 768})
        except Exception as _e:
            logging.warning(f"Swallowed exception: {_e}")

        # Inject slot labeling logic
        if email:
            init_js = f"""
            (() => {{
                const slot = {slot};
                const email = "{email}";
                const prefix = ` - [S${{slot}}] ${{email}}`;
                
                const updateTitle = () => {{
                    if (!document.title.endsWith(prefix)) {{
                        // Clean existing prefix first if any
                        let base = document.title.split(" - [")[0];
                        document.title = base + prefix;
                    }}
                }};

                // Initialize
                updateTitle();
                setInterval(updateTitle, 1000);
            }})();
            """
            try:
                await page.context.add_init_script(init_js)
                # Apply immediately to current page
                await page.evaluate(init_js)
            except Exception: pass

        try:
            page.on("pageerror", lambda err: None)
        except Exception as _e:
            logging.warning(f"Swallowed exception: {_e}")

        return manager, browser, page
