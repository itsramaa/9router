"""Shared server state — one instance per app."""

from __future__ import annotations

import asyncio
from collections import deque
from typing import Any

from aiohttp import web

# Max recent log lines kept in memory for reconnecting clients
_LOG_BUFFER_MAX = 500


class ServerState:
    def __init__(self) -> None:
        self.ws_clients: set[web.WebSocketResponse] = set()
        self.proc: asyncio.subprocess.Process | None = None
        self.proc_task: asyncio.Task | None = None
        self.proc_stdin: asyncio.StreamWriter | None = None
        # Extra processes for retry / bulk-harvest (don't conflict with main proc)
        self.retry_procs: list[asyncio.subprocess.Process] = []
        self.retry_tasks: list[asyncio.Task] = []
        # AUDIT-001 fix: lock for retry_procs/retry_tasks to prevent TOCTOU races
        self.retry_lock: asyncio.Lock = asyncio.Lock()

        # ── Harvest session state (persisted across reconnects) ──────────────
        # Mirrors the last `started` payload so new clients can restore UI state
        self.harvest_session: dict[str, Any] = {}
        # Per-slot state: {slot_id: {email, status, providers, ...}}
        self.slot_states: dict[str, Any] = {}
        # Per-account progress: {email: {status, keys, providers, ...}}
        self.account_states: dict[str, Any] = {}
        # Recent log lines ring buffer — replayed to reconnecting clients
        self.log_buffer: deque[dict] = deque(maxlen=_LOG_BUFFER_MAX)

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    def on_started(self, payload: dict) -> None:
        """Called when harvest starts — store session config."""
        self.harvest_session = payload
        self.slot_states.clear()
        self.account_states.clear()
        self.log_buffer.clear()

    def on_stopped(self) -> None:
        """Called when harvest stops — keep last results but mark idle."""
        self.harvest_session.pop("running", None)

    def update_slot(self, slot: str | int, data: dict) -> None:
        key = str(slot)
        if key not in self.slot_states:
            self.slot_states[key] = {}
        self.slot_states[key].update(data)

    def update_account(self, email: str, data: dict) -> None:
        if email not in self.account_states:
            self.account_states[email] = {}
        self.account_states[email].update(data)

    def push_log(self, msg: dict) -> None:
        """Buffer a broadcast message for replay to reconnecting clients."""
        # Only buffer log/progress/error/done types — skip frames
        if msg.get("type") in ("frame",):
            return
        self.log_buffer.append(msg)

    def get_reconnect_payload(self) -> dict:
        """Build the full state snapshot sent to a newly connected client."""
        return {
            "type": "reconnect_state",
            "running": self.is_running(),
            "session": self.harvest_session,
            "slots": self.slot_states,
            "accounts": self.account_states,
            "log_buffer": list(self.log_buffer),
        }

    async def cleanup_retry(self) -> None:
        """Remove completed retry tasks/procs to prevent unbounded growth."""
        async with self.retry_lock:
            done_tasks = [t for t in self.retry_tasks if t.done()]
            for t in done_tasks:
                self.retry_tasks.remove(t)
            done_procs = [p for p in self.retry_procs if p.returncode is not None]
            for p in done_procs:
                self.retry_procs.remove(p)
