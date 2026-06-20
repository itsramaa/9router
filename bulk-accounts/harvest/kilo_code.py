from __future__ import annotations
"""
Kilo Code — harvest provider connection.
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

_S = SELECTORS["kilo_code"]

async def harvest(page: Any, email: str, password: str, provider: str = "kilo_code") -> str:
    emit_progress(provider, "navigate", "Starting Kilo Code Connection...")
    try:
        await dashboard_login(page)
        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/kilocode"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if await email_in_connection_list(page, email):
            return f"Kilo Code : Already connected ({email})"

        if not await click_first_visible(page, _S["ADD_BTN"]): return ""
        await asyncio.sleep(2)

        emit_progress(provider, "captcha", "Waiting for user to solve CAPTCHA...")
        ok = await handle_oauth_popup(
            page, email, password,
            google_btn_sels=_S["GOOGLE_BTN"],
            captcha_prompt="Kilo Code CAPTCHA — Selesaikan CAPTCHA lalu tekan ENTER",
            captcha_before_popup=False,
            skip_sels=_S["SKIP_BTN"],
            authorize_sels=_S["AUTH_BTN"],
            close_new_tab=True,
        )
        if not ok: return ""

        await asyncio.sleep(3)
        await safe_goto(page, url)
        await asyncio.sleep(3)

        for _ in range(6):
            if await email_in_connection_list(page, email):
                return f"Kilo Code : Success"
            await asyncio.sleep(3)
        return ""
    except Exception as e:
        emit_error(provider, e); return ""