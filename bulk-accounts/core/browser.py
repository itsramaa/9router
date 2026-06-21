"""Browser launcher — Camoufox wrapper for harvest workers."""

from __future__ import annotations

import asyncio
import glob
import logging
import os
import shutil
import sys
import tempfile
from typing import Any
from urllib.parse import urlparse


def cleanup_camoufox_temp() -> None:
    """Delete temp dirs created by Camoufox/Playwright after each session."""
    tmp = tempfile.gettempdir()
    for pat in ("playwright*", "camoufox*", "moz-screenshot*", "rust_mozprofile*"):
        for path in glob.glob(os.path.join(tmp, pat)):
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
            except Exception as _e:
                logging.warning(f"Cleanup error: {_e}")


class BrowserManager:
    active_tasks: dict[int, asyncio.Task] = {}

    @staticmethod
    async def launch(
        slot: int = 0, email: str = "", proxy_url: str = ""
    ) -> tuple[Any, Any, Any]:
        from camoufox.async_api import AsyncCamoufox
        from browserforge.fingerprints import Screen

        _headless_env = os.getenv("BATCHER_CAMOUFOX_HEADLESS", "true").lower()
        if _headless_env == "true":
            _headless_val: Any = True
        elif _headless_env == "virtual":
            # Virtual display mode — only meaningful on Linux with no real display.
            # On Windows/Mac, fall back to headed (False) since Xvfb is unavailable.
            if sys.platform.startswith("linux"):
                _headless_val = "virtual"
            else:
                _headless_val = False
        else:
            # "false" or any other value → headed browser
            if (
                sys.platform.startswith("linux")
                and not os.environ.get("DISPLAY")
                and not os.environ.get("WAYLAND_DISPLAY")
            ):
                _headless_val = "virtual"
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
            logging.warning(f"Permission grant error: {_e}")

        page.set_default_timeout(20000)
        try:
            await page.set_viewport_size({"width": 1366, "height": 768})
        except Exception as _e:
            logging.warning(f"Viewport error: {_e}")

        if email:
            init_js = f"""
            (() => {{
                const slot = {slot};
                const email = "{email}";
                const prefix = ` - [${{slot}}] ${{email}}`;
                const updateTitle = () => {{
                    if (!document.title.endsWith(prefix)) {{
                        document.title = document.title.split(" - [")[0] + prefix;
                    }}
                }};
                updateTitle();
                setInterval(updateTitle, 1000);
            }})();
            """
            try:
                await page.context.add_init_script(init_js)
                await page.evaluate(init_js)
            except Exception:
                pass

        try:
            page.on("pageerror", lambda err: None)
        except Exception as _e:
            logging.warning(f"pageerror handler error: {_e}")

        return manager, browser, page
