from __future__ import annotations
"""
google_session.py — Shared Google login guard.

ensure_google_session(page, email, password) guarantees the browser context
has an active Google session before the caller proceeds.  It is safe to call
from every provider: the result is cached in _google_session_ok so the actual
login flow runs at most once per worker run, regardless of how many providers
need Google.

Flow:
  1. If _google_session_ok is already True → return True immediately (no-op).
  2. Navigate to accounts.google.com to probe session state.
  3. If Google redirects straight to the account page (no /signin, no
     /identifier) → session is alive, cache True, restore previous URL.
  4. Otherwise run handle_google_flow() for a full email+password+consent login.
  5. On success cache True and restore previous URL; on failure return False.
"""

import asyncio
from typing import Any

from core.context import _google_session_ok
from .base import emit_progress, emit_error
from .google import handle_google_flow, handle_google_account_chooser
from .utils import safe_goto

_PROBE_URL = "https://accounts.google.com/"
_SIGNED_IN_INDICATORS = ("/myaccount", "/SignOutOptions", "myaccount.google.com", "/accounts/SetSID")
_NEEDS_LOGIN_INDICATORS = ("/signin", "/identifier", "/v3/signin", "/ServiceLogin")


def _is_signed_in(url: str) -> bool:
    return not any(ind in url for ind in _NEEDS_LOGIN_INDICATORS)


async def ensure_google_session(page: Any, email: str, password: str) -> bool:
    """
    Ensure Google is logged in for this browser context.
    Returns True if session is active (or was successfully established).
    Returns False if login failed.

    Restores page.url to whatever it was before this call so callers
    do not need to re-navigate after calling this.
    """
    # Fast path: already confirmed this run
    if _google_session_ok.get():
        return True

    prev_url: str = page.url

    try:
        emit_progress("google_session", "probe", f"Probing Google session for {email}...")

        await safe_goto(page, _PROBE_URL)
        await asyncio.sleep(2)

        current = page.url

        if _is_signed_in(current):
            # Could still be chooser page — pick the right account
            await handle_google_account_chooser(page, email)
            await asyncio.sleep(1)
            emit_progress("google_session", "cached", "Google session already active.")
            _google_session_ok.set(True)
            return True

        # Need a full login
        emit_progress("google_session", "login", "Google not signed in — running login flow...")
        ok = await handle_google_flow(page, email, password, timeout=200.0)
        if ok:
            emit_progress("google_session", "ok", "Google login successful.")
            _google_session_ok.set(True)
            return True
        else:
            emit_error("google_session", "Google login flow failed.")
            return False

    except Exception as e:
        emit_error("google_session", e)
        return False
    finally:
        # Restore caller's page position so providers don't land on Google
        if prev_url and prev_url != "about:blank" and prev_url != _PROBE_URL:
            try:
                await safe_goto(page, prev_url)
                await asyncio.sleep(1)
            except Exception:
                pass
