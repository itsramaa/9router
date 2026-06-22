"""WebSocket handler & subprocess streaming."""

from __future__ import annotations

import asyncio
import json
import logging
import re

from aiohttp import web, WSMsgType

from .state import ServerState

import os as _os

# AUDIT-006: Bounded send timeout per client — slow clients get disconnected
_WS_SEND_TIMEOUT = 3.0  # seconds

# AUDIT-020: Allowed WebSocket origins — configurable via WS_ALLOWED_ORIGINS env var
# Format: comma-separated origins, e.g. "http://localhost,http://192.168.1.100"
# Falls back to localhost-only when not set
_ALLOWED_ORIGINS = {
    o.strip() for o in _os.getenv("WS_ALLOWED_ORIGINS", "").split(",") if o.strip()
} or {
    "http://localhost",
    "https://localhost",
    "http://127.0.0.1",
    "https://127.0.0.1",
    "http://0.0.0.0",
    "https://0.0.0.0",
}


class WebSocketManager:
    def __init__(self, state: ServerState):
        self.state = state
        self._pending_tasks: set = (
            set()
        )  # BUG-034: store refs to prevent task leak warnings

    async def broadcast(self, msg: dict) -> None:
        if not self.state.ws_clients:
            return
        text = json.dumps(msg, ensure_ascii=False)

        async def _send(ws):
            try:
                # AUDIT-006: Per-client send timeout to prevent slow-client queue buildup
                await asyncio.wait_for(ws.send_str(text), timeout=_WS_SEND_TIMEOUT)
            except asyncio.TimeoutError:
                logging.warning("WS client send timed out — disconnecting slow client")
                self.state.ws_clients.discard(ws)
                try:
                    await ws.close()
                except Exception:
                    pass
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
                    # Update slot/account state from progress events
                    self._update_state_from_msg(data)
                    self.state.push_log(data)
                    await self.broadcast(data)
                except json.JSONDecodeError:
                    # Plain text line — strip any leading slot prefix like "4]" or "[1]"
                    stripped = raw
                    stripped = re.sub(r"^\[?\d+\]?\s*", "", stripped, count=1)
                    # BUG-035 fix: check raw line before strip for frame type patterns
                    if '"type"' in raw and ('"frame"' in raw or '"base64"' in raw):
                        continue
                    # Skip if stripped version looks like frame JSON
                    if '"type"' in stripped and (
                        '"frame"' in stripped or '"base64"' in stripped
                    ):
                        continue
                    # Skip raw base64 blobs (long strings with no spaces/braces)
                    if len(stripped) > 300 and not any(
                        c in stripped for c in ("{", "}", " ")
                    ):
                        continue
                    msg = {"type": "log", "message": raw}
                    self.state.push_log(msg)
                    await self.broadcast(msg)
        except Exception as _e:
            logging.warning(f"Swallowed exception: {_e}")
        finally:
            await proc.wait()
            done_msg = {
                "type": "done_stream",
                "returncode": proc.returncode,
                "message": "Harvest process finished",
            }
            self.state.on_stopped()
            self.state.push_log(done_msg)
            await self.broadcast(done_msg)

    def _update_state_from_msg(self, data: dict) -> None:
        """Extract slot/account state from broadcast messages for reconnect replay."""
        msg_type = data.get("type")
        # Slot start/done
        slot = data.get("slot")
        email = data.get("email")
        if slot is not None and email:
            self.state.update_slot(slot, {"email": email, "status": "running"})
            self.state.update_account(email, {"slot": slot, "status": "running"})
        # Account done
        if msg_type == "done" and email:
            keys = data.get("keys", 0)
            self.state.update_account(email, {"status": "done", "keys": keys})
            if slot is not None:
                self.state.update_slot(slot, {"status": "idle", "email": None})
        # Account error/skip
        if msg_type in ("error", "skip") and email:
            self.state.update_account(email, {"status": msg_type})

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        # AUDIT-020: Validate Origin header — only allow configured origins
        # Skip check if WS_ALLOWED_ORIGINS=* (Docker/self-hosted mode)
        _origins_env = _os.getenv("WS_ALLOWED_ORIGINS", "")
        skip_origin_check = _origins_env.strip() == "*"

        origin = request.headers.get("Origin", "")
        if origin and not skip_origin_check:
            allowed = any(
                origin == o or origin.startswith(o + ":") for o in _ALLOWED_ORIGINS
            )
            if not allowed:
                logging.warning(f"WS connection rejected — disallowed origin: {origin}")
                raise web.HTTPForbidden(reason="WebSocket origin not allowed")

        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.state.ws_clients.add(ws)
        try:
            # Send full reconnect state so client can restore UI after page refresh
            await ws.send_str(json.dumps(self.state.get_reconnect_payload()))
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if data.get("type") == "ping":
                            await ws.send_str(json.dumps({"type": "pong"}))
                    except Exception as _e:
                        logging.warning(f"Swallowed exception: {_e}")
                elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        finally:
            self.state.ws_clients.discard(ws)
        return ws
