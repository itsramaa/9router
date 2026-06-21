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
