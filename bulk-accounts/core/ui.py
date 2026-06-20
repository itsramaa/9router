"""Terminal UI helpers (colors, banners, interactive prompts)."""
from __future__ import annotations

import asyncio
import collections
import logging
import os
import sys
from typing import Any
from .context import _email as _current_email

try:
    import msvcrt
except ImportError:
    msvcrt = None # type: ignore

try:
    import select
except ImportError:
    select = None # type: ignore

# ── Colors ────────────────────────────────────────────────────────────────────
_NO_COLOR = not sys.stdout.isatty() or os.environ.get("NO_COLOR")

def color(text: str, code: str) -> str:
    """Wrap text in ANSI color codes."""
    if _NO_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"

# Standard color shortcuts
def c_ok(m: str) -> str: return color(m, "92")     # Green
def c_err(m: str) -> str: return color(m, "91")    # Red
def c_warn(m: str) -> str: return color(m, "93")   # Yellow
def c_info(m: str) -> str: return color(m, "96")   # Cyan
def c_dim(m: str) -> str: return color(m, "2")     # Dim
def c_step(m: str) -> str: return color(m, "94")   # Blue
def c_bold(m: str) -> str: return color(m, "1")    # Bold

# ── Generic TUI Helpers ───────────────────────────────────────────────────────
_sys_stdout = sys.__stdout__

def tui_print(*args, **kwargs):
    """Print directly to terminal, bypassing any captured stdout."""
    kwargs["file"] = _sys_stdout
    print(*args, **kwargs)

async def ainput(prompt: str = "") -> str:
    """asyncio-safe input() — runs blocking input in thread executor."""
    try:
        UIState.input_active = True
        loop = asyncio.get_running_loop()
        if prompt:
            tui_print(prompt, end="", flush=True)
        return await loop.run_in_executor(None, input)
    finally:
        UIState.input_active = False

class NullWriter:
    """A file-like object that discards all input."""
    def write(self, _data: Any): pass
    def flush(self): pass

_sys_stderr = sys.__stderr__


# ── STATEFUL LOGGING & TUI DASHBOARD ───────────────────────────────────────
class UIState:
    current_email = _current_email
    active_view: str = "menu" # 'menu' or an email address
    input_active: bool = False
    
    # Store logs per account for isolated viewing
    account_logs: dict[str, list[str]] = collections.defaultdict(list)
    task_statuses: dict[str, str] = {}
    
    @classmethod
    def get_prefix(cls) -> str:
        email = cls.current_email.get()
        return f"[{email}] " if email else ""

    @classmethod
    def log(cls, text: str):
        email = cls.current_email.get()
        if email:
            cls.account_logs[email].append(text)
            if cls.active_view == email:
                tui_print(text, flush=True)
        elif cls.active_view == "menu":
            tui_print(text, flush=True)
        elif cls.active_view != "menu" and not email:
             # If we are viewing an account but a global log arrives, just print it?
             # For now, print to console if no specific UI task is active
             tui_print(text, flush=True)

def banner(msg: str):
    line = "═" * 65
    b = f"\n{c_bold(line)}\n{c_bold(c_info(f'  {UIState.get_prefix()}{msg}'))}\n{c_bold(line)}"
    UIState.log(b)

def ok(msg: str):   UIState.log(c_ok(f"  ✓ {UIState.get_prefix()}{msg}"))
def err(msg: str):  UIState.log(c_err(f"  ✗ {UIState.get_prefix()}{msg}"))
def warn(msg: str): UIState.log(c_warn(f"  ⚠ {UIState.get_prefix()}{msg}"))
def info(msg: str): UIState.log(c_info(f"  → {UIState.get_prefix()}{msg}"))
def dim(msg: str):  UIState.log(c_dim(f"    {UIState.get_prefix()}{msg}"))
def step(msg: str): UIState.log(c_step(f"\n  ▸ {UIState.get_prefix()}{msg}"))

def flush_stdin():
    """Flush pending input in terminal to avoid skipping/proceeding immediately."""
    if msvcrt:
        try:
            while msvcrt.kbhit():
                msvcrt.getch()
        except Exception: pass
    elif select:
        try:
            while select.select([sys.stdin], [], [], 0.0)[0]:
                sys.stdin.readline()
        except Exception: pass


def emit_as_terminal_log(data: dict) -> None:
    """
    Shared Emit callback — pretty-print emit() data ke terminal sebagai log stream.
    Dipakai oleh run.py (non-interactive) dan manual_run.py (interactive).
    Filter noise frame/ping/interact events.
    """
    if data.get("type") in ("frame", "ping", "interact_required", "interact_result", "interact_done"):
        return
    email = data.get("email", "")
    msg = data.get("message") or data.get("error") or ""
    if not msg:
        return
    t = data.get("type", "")
    prefix = f"[{email}] " if email and email != "Idle" else ""
    if t == "error":     tui_print(c_err(f"  ✗ {prefix}{msg.strip()}"), flush=True)
    elif t == "warn":    tui_print(c_warn(f"  ⚠ {prefix}{msg.strip()}"), flush=True)
    elif t == "api_key": tui_print(c_ok(f"  ✓ {prefix}{msg.strip()}"), flush=True)
    elif t == "done":    tui_print(c_ok(f"\n  ✓ {msg.strip()}"), flush=True)
    else:                tui_print(f"  {prefix}{msg.strip()}", flush=True)


class TUIDashboard:
    """Consolidated Dashboard rendering logic for manual_run.py."""
    
    @staticmethod
    async def loop():
        """Background task: renders status dashboard, handles keypress navigation."""
        import time
        from core.interact_terminal import get_pending_interventions
        
        last_status_repr = ""
        digit_buffer, last_digit_time = "", 0.0

        while True:
            await asyncio.sleep(0.1)
            # 1. Keyboard Input
            if UIState.input_active:
                await asyncio.sleep(0.2)
                continue

            if msvcrt:
                while msvcrt.kbhit():
                    char = msvcrt.getwch()
                    if UIState.active_view == "menu":
                        if char.isdigit():
                            digit_buffer += char
                            last_digit_time = time.monotonic()
                    elif char.lower() == "b":
                        UIState.active_view = "menu"
                        last_status_repr = ""
                    elif char.lower() == "s" and UIState.active_view != "menu":
                        # Fast skip from within isolated view
                        email = UIState.active_view
                        accounts = list(UIState.task_statuses.keys())
                        if email in accounts:
                            slot = accounts.index(email) + 1
                            from .browser import BrowserManager
                            from .interact import InteractMode
                            def _do_skip():
                                task = BrowserManager.active_tasks.get(slot)
                                if task and not task.done():
                                    task.cancel()
                                InteractMode.queue_action(slot, "skip")
                            asyncio.get_running_loop().call_soon(_do_skip)
                            UIState.active_view = "menu"
                            last_status_repr = ""

                # Handle multi-digit selection (e.g. 1, then 2 = 12)
                if UIState.active_view == "menu" and digit_buffer and time.monotonic() - last_digit_time > 0.4:
                    idx = int(digit_buffer); digit_buffer = ""
                    accounts = list(UIState.task_statuses.keys())
                    if 1 <= idx <= len(accounts):
                        email = accounts[idx - 1]
                        UIState.active_view = email
                        last_status_repr = ""
                        tui_print("\033[2J\033[H", end="")
                        tui_print(c_bold(c_step(f"\n--- Isolated Logs for {email} ---")), flush=True)
                        for line in UIState.account_logs[email]:
                            tui_print(line, flush=True)
                        
                        pending = get_pending_interventions()
                        if email in pending:
                            pending[email].event.set()

            # 2. Rendering
            pending = get_pending_interventions()
            if UIState.active_view == "menu":
                current_status = f"{repr(UIState.task_statuses)}{repr(list(pending.keys()))}{digit_buffer}"
                
                if current_status != last_status_repr:
                    tui_print("\033[2J\033[H", end="")
                    tui_print(c_bold(c_info("\n=== Bulk Harvester Dashboard ===")), flush=True)
                    if not UIState.task_statuses:
                        tui_print("  Waiting for accounts...", flush=True)
                    
                    for i, (email, status) in enumerate(UIState.task_statuses.items(), 1):
                        if email in pending:
                            tui_print(c_warn(f"  {i}. {email} - ⚠️ WAITING MANUAL ({pending[email].provider})"), flush=True)
                        else:
                            tui_print(c_ok(f"  {i}. {email} - {status}"), flush=True)
                    
                    tui_print(c_bold(c_info("\n" + "=" * 35)), flush=True)
                    hint = f"Selecting: {digit_buffer}..." if digit_buffer else f"Press [1-{len(UIState.task_statuses)}] to view/intervene."
                    tui_print(c_warn(hint), flush=True)
                    last_status_repr = current_status
            else:
                # Isolated view auto-polling: detect if intervention is needed for current view
                email = UIState.active_view
                if email in pending:
                    pending[email].event.set()
                
                status = UIState.task_statuses.get(email, "")
                is_waiting = "Waiting" in status or "PAUSE" in status or email in pending
                # Only update if the generic 'waiting' state actually flipped
                current_isolated_state = "waiting" if is_waiting else "running"
                
                if current_isolated_state != last_status_repr:
                    if is_waiting:
                        tui_print(c_warn("\n[Waiting for interact gate, please wait a moment...]"), flush=True)
                    else:
                        tui_print(c_warn("\n[Account is running. Logs will appear above. Press 's' to skip, 'b' to go back.]"), flush=True)
                    last_status_repr = current_isolated_state
