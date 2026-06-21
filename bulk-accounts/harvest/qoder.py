from __future__ import annotations

"""
Qoder — harvest provider connection.
"""

import asyncio
from typing import Any
from core.config import Config
from core.selectors import SELECTORS
from .base import (
    emit_progress,
    emit_error,
    handle_oauth_popup,
    check_already_connected,
    verify_connection_in_dashboard,
)
from .google_session import ensure_google_session
from .utils import click_first_visible, safe_goto

_S = SELECTORS["qoder"]


async def harvest(page: Any, email: str, password: str, provider: str = "qoder") -> str:
    emit_progress(provider, "navigate", "Starting Qoder Connection...")
    try:
        # Check if already connected
        if await check_already_connected(email, provider, "Qoder"):
            return ""

        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/{provider}"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if not await click_first_visible(page, _S["ADD_BTN"]):
            return ""
        await asyncio.sleep(3)

        ok, _ = await handle_oauth_popup(
            page,
            email,
            password,
            google_btn_sels=_S["GOOGLE_BTN"],
            close_new_tab=True,
            post_auth_delay=8,
        )
        if not ok:
            return ""

        await asyncio.sleep(3)
        for extra in list(page.context.pages):
            if extra is not page:
                try:
                    if "localhost" in extra.url:
                        await extra.close()
                except Exception:
                    pass

        await safe_goto(page, url)
        await asyncio.sleep(3)

        # Verify connection in dashboard
        await verify_connection_in_dashboard(page, email, provider)
        return ""  # Success for log_only provider
    except Exception as e:
        emit_error(provider, e)
        return ""
