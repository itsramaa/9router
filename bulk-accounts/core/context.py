"""Unified async context storage for the harvester."""
from __future__ import annotations
from contextvars import ContextVar
from typing import Any

# Global context for the current worker/slot
_slot: ContextVar[int] = ContextVar("slot", default=0)
_email: ContextVar[str] = ContextVar("email", default="")
_page: ContextVar[Any] = ContextVar("page", default=None)
_streamer: ContextVar[Any] = ContextVar("streamer", default=None)
_emit_cb: ContextVar[Any] = ContextVar("emit_cb", default=None)

# Set to True once Google is confirmed logged-in for this browser context.
# Shared across all providers in the same worker run — avoids redundant logins.
_google_session_ok: ContextVar[bool] = ContextVar("google_session_ok", default=False)
