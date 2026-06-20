from __future__ import annotations
"""
Antigravity — harvest provider connection.
"""

import asyncio
from typing import Any
from core.config import Config
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, handle_oauth_popup
from .dashboard import email_in_connection_list
from .utils import click_first_visible, safe_goto

_S = SELECTORS["antigravity"]

async def harvest(page: Any, email: str, password: str, provider: str = "antigravity") -> str:
    emit_progress(provider, "navigate", "Starting Antigravity Connection...")
    try:
        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/antigravity"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if await email_in_connection_list(page, email):
            return f"Antigravity : Already connected ({email})"

        for attempt in range(3):
            await click_first_visible(page, _S["ADD_BTN"])
            await asyncio.sleep(3)
            await click_first_visible(page, _S["CONTINUE_BTN"])
            
            if await handle_oauth_popup(page, email, password, post_auth_delay=5):
                await safe_goto(page, url)
                await asyncio.sleep(3)

                for _ in range(10):
                    if await email_in_connection_list(page, email):
                        return f"Antigravity : Success"
                    await asyncio.sleep(3)

            if attempt < 2:
                emit_progress(provider, "retry", f"Retrying (attempt {attempt + 2}/3)...")
                await click_first_visible(page, _S["CANCEL_BTN"], no_interact=True, retry=False)
                await asyncio.sleep(3)
        return ""
    except Exception as e:
        emit_error(provider, e); return ""