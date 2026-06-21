"""Browser frame (screenshot) streaming."""

from __future__ import annotations

import asyncio
import base64

from .emit import Emit

# JPEG quality for frame streaming. q30 keeps frames small enough for the
# asyncio readline buffer (default 64KB) while still being readable.
_FRAME_Q = 30
_FRAME_INTERVAL = 1.5  # seconds between captures per slot
_SCREENSHOT_TIMEOUT = 5000  # ms — prevent one slot's screenshot from starving others


class FrameStreamer:
    def __init__(self, page, slot: int):
        self.page = page
        self.slot = slot
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None

    def set_page(self, page) -> None:
        """Switch to a different page (e.g. new tab opened during interact)."""
        self.page = page

    def start(self) -> asyncio.Task:
        # Stagger start by slot index to prevent all slots screenshotting simultaneously
        self._task = asyncio.create_task(self._run())
        return self._task

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _capture(self) -> bytes | None:
        """Capture full viewport as JPEG with timeout to prevent event loop starvation."""
        try:
            return await asyncio.wait_for(
                self.page.screenshot(type="jpeg", quality=_FRAME_Q, full_page=False),
                timeout=_SCREENSHOT_TIMEOUT / 1000,
            )
        except (asyncio.TimeoutError, Exception):
            return None

    async def capture_once(self) -> None:
        """Capture and emit a single frame immediately."""
        buf = await self._capture()
        if buf:
            await Emit.async_call(
                {
                    "type": "frame",
                    "slot": self.slot,
                    "format": "jpeg",
                    "base64": base64.b64encode(buf).decode("ascii"),
                }
            )

    async def _run(self) -> None:
        # Stagger: slot N waits N*0.5s before first capture so slots don't all
        # hit screenshot() at the same instant
        await asyncio.sleep(self.slot * 0.5)

        while not self._stop.is_set():
            if getattr(self.page, "_crash_flag", False):
                break

            # If current page is closed, switch to another available page
            try:
                if self.page.is_closed():
                    pages = self.page.context.pages
                    for p in reversed(pages):
                        if not p.is_closed():
                            self.page = p
                            break
            except Exception:
                pass

            buf = await self._capture()
            if buf is None:
                await asyncio.sleep(_FRAME_INTERVAL)
                continue
            await Emit.async_call(
                {
                    "type": "frame",
                    "slot": self.slot,
                    "format": "jpeg",
                    "base64": base64.b64encode(buf).decode("ascii"),
                }
            )
            # Automatic tab detection: switch to the most recently created page
            # that isn't the current main page. Avoid picking up random popups.
            try:
                pages = self.page.context.pages
                if len(pages) > 1:
                    # Pick the newest page that's not the current one
                    for p in reversed(pages):
                        if not p.is_closed() and p != self.page:
                            self.page = p
                            from .interact import update_interact_page

                            update_interact_page(self.slot, p, self)
                            break
            except Exception:
                pass

            await asyncio.sleep(_FRAME_INTERVAL)
