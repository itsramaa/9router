"""
Interact gate — event-based, driven by the web dashboard UI.

Flow:
  1. harvest module calls interact_gate(slot, page, reason)
  2. gate emits {type: "interact_required"} → WS → frontend
  3. user acts in browser view (click/type/scroll) via POST /api/interact
  4. handlers.py writes "interact <slot> <action>" to process stdin
  5. browser.py stdin listener calls InteractMode.queue_action(slot, action)
  6. gate processes queued actions, resolves when user sends continue/skip/abort
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

from .context import (
    _slot as _current_slot,
    _email as _current_email,
    _page as _current_page,
    _streamer as _current_streamer,
    _emit_cb as _current_emit,
)
from .emit import Emit


class ManualKeyIntercepted(BaseException):
    """Raised to immediately save a manually-provided key and skip to next provider."""
    def __init__(self, key: str):
        self.key = key


class InteractMode:
    """Per-slot event store. Driven by browser.py stdin listener."""
    _pending: dict[int, asyncio.Event] = {}
    _actions: dict[int, str] = {}
    _action_queues: dict[int, asyncio.Queue] = {}

    @classmethod
    def queue_action(cls, slot: int, action: str) -> None:
        """Called by the stdin listener in browser.py."""
        if action in ("continue", "skip", "abort", "retry"):
            cls._actions[slot] = action
            if slot in cls._pending:
                try:
                    cls._pending[slot].set()
                except Exception:
                    pass
        else:
            if slot not in cls._action_queues:
                cls._action_queues[slot] = asyncio.Queue()
            try:
                cls._action_queues[slot].put_nowait(action)
            except Exception:
                pass

    @classmethod
    def cleanup(cls, slot: int) -> None:
        cls._pending.pop(slot, None)
        cls._actions.pop(slot, None)
        cls._action_queues.pop(slot, None)


def update_interact_page(slot: int, page: Any, streamer: Any = None) -> None:
    """Update active page/streamer context (called when a new tab opens)."""
    _current_page.set(page)
    if streamer is not None:
        _current_streamer.set(streamer)
        # Actually switch the streamer so screenshots follow the new page
        try:
            streamer.set_page(page)
        except Exception:
            pass


def get_interact_page(slot: int = 0) -> Any:
    return _current_page.get()


def get_interact_streamer(slot: int = 0) -> Any:
    return _current_streamer.get()


def clear_interact_context(slot: int = 0) -> None:
    _current_slot.set(0)
    _current_page.set(None)
    _current_streamer.set(None)
    _current_emit.set(None)
    _current_email.set("")
    # AUDIT-014: Clean up InteractMode queues to prevent leaks
    InteractMode.cleanup(slot)


async def interact_gate(
    slot: int, page: Any, provider_or_reason: str, email: str = "", emit_fn: Any = None
) -> str:
    """Pause slot and wait for user action via the web UI. Returns empty string in non-interactive mode."""
    from .config import Config
    if not Config.INTERACTIVE_MODE:
        return ""

    if not email:
        email = _current_email.get()

    is_selector = "Selector not found" in provider_or_reason or "Input not found" in provider_or_reason
    display_reason = (
        f"{provider_or_reason} — auto-extract failed. Navigate manually, copy the key, then click Continue"
        if not is_selector else provider_or_reason
    )

    Emit.emit({
        "type": "interact_required",
        "slot": slot,
        "email": email,
        "provider": provider_or_reason,
        "reason": display_reason,
        "message": f"  ⚠️  Slot {slot} — {display_reason}",
    })

    event = asyncio.Event()
    InteractMode._pending[slot] = event
    InteractMode._actions.pop(slot, None)
    if slot not in InteractMode._action_queues:
        InteractMode._action_queues[slot] = asyncio.Queue()

    try:
        while True:
            q = InteractMode._action_queues.get(slot)
            if q:
                while not q.empty():
                    try:
                        await _execute_page_action(page, slot, q.get_nowait())
                    except asyncio.QueueEmpty:
                        break

            if InteractMode._actions.get(slot):
                break

            try:
                await asyncio.wait_for(asyncio.shield(event.wait()), timeout=1.0)
            except asyncio.TimeoutError:
                continue

        action = InteractMode._actions.get(slot, "")
        if action in ("skip", "abort"):
            return ""
        if action == "retry":
            return "__retry__"
        if action == "continue":
            key = ""
            try:
                key = (await page.evaluate("navigator.clipboard.readText()") or "").strip()
            except Exception:
                pass
            Emit.emit({"type": "interact_result", "slot": slot, "action": "continue", "has_key": bool(key)})
            return key if key else "__continue__"
        return ""
    finally:
        InteractMode.cleanup(slot)
        Emit.emit({"type": "interact_done", "slot": slot})


async def _execute_page_action(page: Any, slot: int, action: str) -> None:
    """Execute a non-terminal page action (click, type, scroll, etc.)."""
    _parts = action.split(" ", 2)
    if len(_parts) >= 2 and _parts[0] in ("click", "scroll", "type"):
        action = ":".join(_parts)

    active_page = _current_page.get() or page
    streamer = _current_streamer.get()

    try:
        if action.startswith("click:"):
            _, x, y = action.split(":", 2)
            await active_page.mouse.click(int(x), int(y))
            Emit.progress("interact", "click", f"  🖱 Slot {slot} — click ({x},{y})")
            await asyncio.sleep(0.5)
            if streamer:
                pages = active_page.context.pages
                if len(pages) > 1 and pages[-1] != active_page:
                    newest = pages[-1]
                    streamer.set_page(newest)
                    _current_page.set(newest)
                    active_page = newest
                await streamer.capture_once()
        elif action.startswith("type:"):
            text = base64.b64decode(action.split(":", 1)[1]).decode("utf-8", errors="replace")
            await active_page.keyboard.type(text)
            Emit.progress("interact", "type", f"  ⌨ Slot {slot} — typed {len(text)} chars")
        elif action.startswith("scroll:"):
            _, dx, dy = action.split(":", 2)
            await active_page.mouse.wheel(int(dx), int(dy))
            if streamer:
                await streamer.capture_once()
        elif action == "screenshot":
            if streamer:
                await streamer.capture_once()
        elif action == "back":
            try:
                await active_page.go_back(timeout=5000)
            except Exception:
                pass
            if streamer:
                await streamer.capture_once()
        elif action == "reload":
            try:
                await active_page.reload(timeout=10000)
            except Exception:
                pass
            if streamer:
                await streamer.capture_once()
        elif action.startswith("goto:"):
            try:
                await active_page.goto(action[5:].strip(), timeout=15000)
            except Exception:
                pass
            if streamer:
                await streamer.capture_once()
    except Exception as e:
        logging.warning(f"Action failed: {action} - {e}")
