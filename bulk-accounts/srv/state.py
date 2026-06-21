"""Shared server state — one instance per app."""

from __future__ import annotations

import asyncio

from aiohttp import web


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

    async def cleanup_retry(self) -> None:
        """Remove completed retry tasks/procs to prevent unbounded growth."""
        async with self.retry_lock:
            done_tasks = [t for t in self.retry_tasks if t.done()]
            for t in done_tasks:
                self.retry_tasks.remove(t)
            done_procs = [p for p in self.retry_procs if p.returncode is not None]
            for p in done_procs:
                self.retry_procs.remove(p)
