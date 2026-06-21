"""WebSocket handler & subprocess streaming."""
from __future__ import annotations

import asyncio
import json
import logging
import re

from aiohttp import web, WSMsgType

from .state import ServerState


class WebSocketManager:
    def __init__(self, state: ServerState):
        self.state = state
        self._pending_tasks: set = set()  # BUG-034: store refs to prevent task leak warnings

    async def broadcast(self, msg: dict) -> None:
        if not self.state.ws_clients:
            return
        text = json.dumps(msg, ensure_ascii=False)
        # BUG-034 fix: store task references to prevent "Task destroyed but pending" warnings
        async def _send(ws):
            try:
                await ws.send_str(text)
            except Exception:
                self.state.ws_clients.discard(ws)
        for ws in list(self.state.ws_clients):
            task = asyncio.create_task(_send(ws))
            self._pending_tasks.add(task)
            task.add_done_callback(self._pending_tasks.discard)

    async def stream_proc(self, proc: asyncio.subprocess.Process) -> None:
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                raw = line.decode("utf-8", errors="replace").strip()
                if not raw:
                    continue
                try:
                    data = json.loads(raw)
                    # Never forward raw frame data as a log message — it's handled client-side
                    if data.get("type") == "frame":
                        await self.broadcast(data)
                        continue
                    await self.broadcast(data)
                except json.JSONDecodeError:
                    # Plain text line — strip any leading slot prefix like "4]" or "[1]"
                    stripped = raw
                    stripped = re.sub(r'^\[?\d+\]?\s*', '', stripped, count=1)
                    # BUG-035 fix: check raw line before strip for frame type patterns
                    if '"type"' in raw and ('"frame"' in raw or '"base64"' in raw):
                        continue
                    # Skip if stripped version looks like frame JSON
                    if '"type"' in stripped and ('"frame"' in stripped or '"base64"' in stripped):
                        continue
                    # Skip raw base64 blobs (long strings with no spaces/braces)
                    if len(stripped) > 300 and not any(c in stripped for c in ('{', '}', ' ')):
                        continue
                    await self.broadcast({"type": "log", "message": raw})
        except Exception as _e:
            logging.warning(f'Swallowed exception: {_e}')
        finally:
            await proc.wait()
            await self.broadcast({
                "type": "done_stream",
                "returncode": proc.returncode,
                "message": "Harvest process finished",
            })

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.state.ws_clients.add(ws)
        try:
            is_running = self.state.proc is not None and self.state.proc.returncode is None
            await ws.send_str(json.dumps({"type": "connected", "running": is_running}))
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if data.get("type") == "ping":
                            await ws.send_str(json.dumps({"type": "pong"}))
                    except Exception as _e:
                        logging.warning(f'Swallowed exception: {_e}')
                elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            self.state.ws_clients.discard(ws)
        return ws
