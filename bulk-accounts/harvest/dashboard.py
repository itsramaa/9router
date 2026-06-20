from __future__ import annotations
"""
dashboard.py — Integration with 9router dashboard.

validate_and_save_to_dashboard now uses the direct HTTP API endpoint
POST /api/automation/inject-key instead of browser navigation.
This eliminates fragile selector-based UI automation and is faster.

Browser-based helpers (dashboard_login, email_in_connection_list,
apply_proxy_to_all_providers) are kept for backwards compatibility
but validate_and_save_to_dashboard no longer uses the browser.
"""

import asyncio
import os
from typing import Any

import httpx

from core.config import Config
from core.selectors import SELECTORS as _S
from .base import emit_progress, emit_error, interact_mode
from .utils import click_first_visible, fill_first_visible, get_text_first_visible, safe_goto


# ── Direct HTTP inject (new, preferred) ─────────────────────────────────────

def _inject_url() -> str:
    base = Config.DASHBOARD_BASE_URL.rstrip("/")
    return f"{base}/api/automation/inject-key"

def _inject_token() -> str | None:
    return os.environ.get("AUTOMATION_INJECT_TOKEN")


async def validate_and_save_to_dashboard(page: Any, key: str, provider: str, email: str) -> None:
    """
    Add a harvested key directly to 9router's database via HTTP API.
    No browser navigation required.
    """
    try:
        emit_progress(provider, "dashboard", f"Injecting key to 9router via API...")

        headers = {"Content-Type": "application/json"}
        token = _inject_token()
        if token:
            headers["x-automation-token"] = token

        payload = {
            "provider": provider,
            "key": key,
            "email": email,
            "name": email,
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(_inject_url(), json=payload, headers=headers)

        if resp.status_code in (200, 201):
            data = resp.json()
            if data.get("ok"):
                emit_progress(provider, "dashboard_ok", f"✓ Key injected to 9router (id={data.get('id', '?')})")
            else:
                emit_progress(provider, "warn", f"inject-key returned error: {data.get('error')}")
        elif resp.status_code == 401:
            emit_progress(provider, "warn", "inject-key: Unauthorized — set AUTOMATION_INJECT_TOKEN env var")
        elif resp.status_code == 400:
            data = resp.json()
            emit_progress(provider, "warn", f"inject-key: {data.get('error', 'bad request')}")
        else:
            emit_progress(provider, "warn", f"inject-key: HTTP {resp.status_code}")

    except httpx.ConnectError:
        emit_progress(provider, "warn", f"inject-key: Cannot connect to {Config.DASHBOARD_BASE_URL} — is 9router running?")
    except Exception as e:
        emit_progress(provider, "warn", f"validate_and_save_to_dashboard failed: {e}")


# ── Browser-based helpers (kept for compatibility) ───────────────────────────

async def dashboard_login(page: Any) -> None:
    """Login to local 9router dashboard if not already logged in."""
    _LP = _S["local_provider"]
    await safe_goto(page, _LP["DASHBOARD_LOGIN_URL"], timeout=10000)
    await asyncio.sleep(3)
    if "login" not in page.url:
        return

    await fill_first_visible(page, _LP["PASS_INPUT"], "123456", timeout=5000, no_interact=True)
    await asyncio.sleep(3)
    await click_first_visible(page, _LP["LOGIN_BTN"], timeout=5000, no_interact=True)
    await asyncio.sleep(1)
    if "login" in page.url:
        await interact_mode(0, page, "Harap login ke Dashboard 9router lalu tekan ENTER")
    emit_progress("dashboard", "login", "Login 9router Successfully")


async def email_in_connection_list(page: Any, email: str) -> bool:
    """Check if email already exists in the 9router Connections section via HTTP API."""
    try:
        headers = {}
        token = _inject_token()
        if token:
            headers["x-automation-token"] = token

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{Config.DASHBOARD_BASE_URL}/api/providers",
                headers=headers,
            )

        if resp.status_code != 200:
            return False

        data = resp.json()
        connections = data.get("connections", [])
        norm = email.strip().lower()
        found = any(
            (c.get("email") or "").lower() == norm or
            (c.get("name") or "").lower() == norm
            for c in connections
        )
        emit_progress("dashboard", "check email", f"Email: {email} already connected: {found}")
        return found

    except Exception:
        return False


async def apply_proxy_to_all_providers(page: Any) -> None:
    """Iterate through all providers and click Apply Proxy on their dashboard pages."""
    _L = _S["local_provider"]
    emit_progress("dashboard", "proxy_sync", "Final Step: Activating Proxy for all providers...")

    await dashboard_login(page)

    targets = [p for p in Config.ALL_PROVIDERS if p not in ["antigravity"]]

    for provider in targets:
        try:
            emit_progress(provider, "proxy", f"Activating Proxy for {provider}...")
            await safe_goto(page, f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/{provider}")
            await asyncio.sleep(2)

            if await click_first_visible(page, _L["APPLY_PROXY_BTN"], timeout=5000, no_interact=True):
                await asyncio.sleep(1)
                await click_first_visible(page, _L["CONFIRM_PROXY_BTN"], timeout=5000, no_interact=True)
                await asyncio.sleep(5)
                emit_progress(provider, "proxy_ok", f"Proxy activated for {provider}")
            else:
                emit_progress(provider, "proxy_skip", f"Apply Proxy button not found for {provider}, skipping.")

        except Exception as e:
            emit_progress(provider, "proxy_err", f"Failed to apply proxy for {provider}: {e}")

    emit_progress("dashboard", "done", "All provider proxies synchronized!")
