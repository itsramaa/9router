from __future__ import annotations
"""
Qoder — harvest provider connection.
"""

import asyncio
from typing import Any
from core.config import Config
from core.selectors import SELECTORS
from .base import (
    emit_progress, emit_error,
    handle_oauth_popup,
)
from .dashboard import email_in_connection_list, dashboard_login
from .utils import click_first_visible, safe_goto

_S = SELECTORS["qoder"]

async def harvest(page: Any, email: str, password: str, provider: str = "qoder") -> str:
    emit_progress(provider, "navigate", "Starting Qoder Connection...")
    try:
        await dashboard_login(page)
        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/qoder"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if await email_in_connection_list(page, email):
            return f"Qoder : Already connected ({email})"

        if not await click_first_visible(page, _S["ADD_BTN"]): return ""
        await asyncio.sleep(3)

        ok = await handle_oauth_popup(
            page, email, password,
            google_btn_sels=_S["GOOGLE_BTN"],
            close_new_tab=True,
            post_auth_delay=8,
        )
        if not ok: return ""

        await asyncio.sleep(3)
        for extra in list(page.context.pages):
            if extra is not page:
                try:
                    if "localhost" in extra.url: await extra.close()
                except Exception: pass

        await safe_goto(page, url)
        await asyncio.sleep(3)

        for _ in range(6):
            if await email_in_connection_list(page, email):
                return f"Qoder : Success"
            await asyncio.sleep(3)
        return ""
    except Exception as e:
        emit_error(provider, e); return ""