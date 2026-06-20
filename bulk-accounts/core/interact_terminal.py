"""Terminal-based intervention gate for manual_run.py."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from core.config import Config
from core.context import _email as _current_email
from core.interact import ManualKeyIntercepted
from core.ui import UIState, ainput, color, ok, err, warn, info, dim, flush_stdin, tui_print


@dataclass
class Intervention:
    email: str
    provider: str
    page: Any
    emit: Any
    event: asyncio.Event
    result: str = ""
    exception: Exception | None = field(default=None)


# Per-email pending interventions
_pending: dict[str, Intervention] = {}


def get_pending_interventions() -> dict[str, Intervention]:
    """Return the current pending interventions map (read-only view)."""
    return _pending


# ── Main terminal interact gate ───────────────────────────────────────────────

async def terminal_interact_gate(slot: int, page: Any, provider: str, email: str = "", emit: Any = None) -> str:
    """Immediately prompts for manual intervention — no menu selection needed."""
    if not email:
        email = _current_email.get()

    event = asyncio.Event()
    _pending[email] = Intervention(email=email, provider=provider, page=page, emit=emit, event=event)
    UIState.task_statuses[email] = f"Waiting Manual ({provider})"

    # In terminal mode: auto-switch to isolated view and fire event immediately
    UIState.active_view = email
    event.set()  # Don't wait for user to pick from menu

    try:
        while True:
            result = await _terminal_interact_inner(page, provider, email)
            if result == "__back__":
                # Re-prompt instead of going back to menu
                continue
            return result
    finally:
        _pending.pop(email, None)
        UIState.task_statuses[email] = "Harvesting..."
        UIState.active_view = "menu"


async def _terminal_interact_inner(page: Any, provider: str, email: str) -> str:
    """Show manual intervention prompt and return user's choice."""
    is_selector = "Selector not found" in provider or "Input not found" in provider
    is_pause = "CAPTCHA" in provider or "login" in provider.lower() or "tekan ENTER" in provider

    # Detect if this is a local/log-only provider
    is_local = False
    for k, v in Config.PROVIDER_REGISTRY.items():
        if v["display"] in provider or k in provider:
            is_local = v.get("log_only", False)
            break

    tui_print()
    if is_pause:
        info(f"PAUSE: {provider}")
    elif is_selector:
        warn(f"Selector not found: {provider}")
    else:
        warn("Auto-harvest failed (no key returned).")

    dim("  [Manual Intervention Mode]")
    if is_selector:
        dim("    A selector failed. Manually perform the action or finish and save the key.")
    elif is_local:
        dim("    Manually complete the connection in the browser.")
    else:
        dim("    Navigate/click/login manually, copy the API key, then press Enter.")
    tui_print()

    flush_stdin()

    if is_pause:
        prompt = f"    [{email}] [Enter] Continue, [b] Back > "
    elif is_selector:
        continue_hint = "[c] Continue" if is_local else "[c] Continue, [Enter] Read Clipboard"
        prompt = f"    [{email}] {continue_hint}, [s] Skip, [b] Back > "
    else:
        action_hint = "Mark connected" if is_local else "Read Clipboard"
        prompt = f"    [{email}] [Enter] {action_hint}, [s] Skip, [b] Back > "

    answer = (await ainput(color(prompt, "93"))).strip()

    if answer.lower() in ("b", "back"):
        return "__back__"
    if answer.lower() == "s":
        err("Skipped by user.")
        raise ManualKeyIntercepted("")
    if is_pause or (answer.lower() == "c" and is_selector):
        info("Resuming automation...")
        return "__continue__"
    if answer.lower() == "retry":
        return "__retry__"
    if len(answer) >= 8:
        info("Read key from terminal input.")
        raise ManualKeyIntercepted(answer)
    if is_local:
        raise ManualKeyIntercepted("__connected__")

    from harvest.utils import read_clipboard
    clip = await read_clipboard(page)
    if clip and len(clip) >= 8:
        raise ManualKeyIntercepted(clip)

    warn("Clipboard is empty or too short!")
    raise ManualKeyIntercepted("")


# ── Empty provider prompt (auto-harvest returned "") ────────────────────────

async def prompt_empty_provider_tui(
    email: str, provider: str, display: str, is_local: bool, page: Any
) -> str:
    """Show manual intervention prompt when auto-harvest returned empty key."""
    event = asyncio.Event()
    _pending[email] = Intervention(email=email, provider=provider, page=page, emit=None, event=event)
    UIState.task_statuses[email] = f"Waiting Manual ({provider})"

    try:
        while True:
            await event.wait()
            flush_stdin()

            if is_local:
                warn(f"{display}: failed.")
                dim("  • Press Enter  → mark as CONNECTED")
                dim("  • Type 'skip'  → skip")
                dim("  • Type 'b'     → back to menu")
                answer = (await ainput(color("    [Enter/skip/b] > ", "93"))).strip().lower()
                if answer in ("b", "back"):
                    UIState.active_view = "menu"
                    event.clear()
                    continue
                return "skip" if answer == "skip" else "__connected__"
            else:
                warn(f"{display}: no key returned.")
                dim("  • Press Enter  → read clipboard")
                dim("  • Type 'retry' → try auto-harvest again")
                dim("  • Type 'skip'  → skip")
                dim("  • Type 'b'     → back to menu")
                answer = (await ainput(color("    [Enter/retry/skip/b] > ", "93"))).strip().lower()
                if answer in ("b", "back"):
                    UIState.active_view = "menu"
                    event.clear()
                    continue
                if answer == "skip":  return "skip"
                if answer == "retry": return "retry"
                from harvest.utils import read_clipboard
                clip = await read_clipboard(page)
                return clip if (clip and len(clip) >= 8) else "skip_empty"
    finally:
        _pending.pop(email, None)
        UIState.task_statuses[email] = "Done."
        UIState.active_view = "menu"
