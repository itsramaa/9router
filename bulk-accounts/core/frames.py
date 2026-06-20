"""Browser frame (screenshot) streaming."""
from __future__ import annotations

import asyncio
import base64

from .emit import Emit

# JPEG quality for frame streaming. q30 keeps frames small enough for the
# asyncio readline buffer (default 64KB) while still being readable.
_FRAME_Q = 30


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
        """Capture full viewport as JPEG."""
        try:
            return await self.page.screenshot(type="jpeg", quality=_FRAME_Q, full_page=False)
        except Exception:
            return None

    async def capture_once(self) -> None:
        """Capture and emit a single frame immediately."""
        buf = await self._capture()
        if buf:
            await Emit.async_call({
                "type": "frame",
                "slot": self.slot,
                "format": "jpeg",
                "base64": base64.b64encode(buf).decode("ascii"),
            })

    async def _run(self) -> None:
        while not self._stop.is_set():
            if getattr(self.page, "_crash_flag", False):
                break
            buf = await self._capture()
            if buf is None:
                await asyncio.sleep(1.0)
                continue
            await Emit.async_call({
                "type": "frame",
                "slot": self.slot,
                "format": "jpeg",
                "base64": base64.b64encode(buf).decode("ascii"),
            })
            # Automatic tab detection: if a new tab opened, switch to it
            try:
                pages = self.page.context.pages
                if len(pages) > 1:
                    newest = pages[-1]
                    if not newest.is_closed() and newest != self.page:
                        self.page = newest
                        # Also update the interact context so actions go to the new page
                        from .interact import update_interact_page
                        update_interact_page(self.slot, newest, self)
            except Exception:
                pass

            await asyncio.sleep(1.0)
