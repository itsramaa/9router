from __future__ import annotations
"""
SiliconFlow — harvest API key.
"""

import asyncio
from typing import Any
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, handle_oauth_popup, check_already_connected
from .google_session import ensure_google_session
from .dashboard import validate_and_save_to_dashboard
from .utils import (
    click_first_visible,
    fill_first_visible,
    get_text_first_visible,
    fake_key_name,
    safe_goto,
    js_scan_for_key,
)

_S = SELECTORS["siliconflow"]
URL_KEYS = _S["URL_KEYS"]

async def harvest(page: Any, email: str, password: str, provider: str = "siliconflow") -> str:
    try:
        # Check if already connected
        if await check_already_connected(email, provider, "SiliconFlow"):
            return ""

        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        await safe_goto(page, URL_KEYS)
        await click_first_visible(page, _S["GOOGLE_BTNS"])
        await asyncio.sleep(3)

        ok, _ = await handle_oauth_popup(
            page, email, password,
            close_new_tab=True,
            post_auth_delay=5,
        )
        if not ok: return ""

        await click_first_visible(page, _S["CREATE_KEY_BTN"])
        await fill_first_visible(page, _S["KEY_NAME_INPUT"], fake_key_name(email))
        await click_first_visible(page, _S["SUBMIT_BTN"])
        await asyncio.sleep(3)
        await click_first_visible(page, _S["SHOW_KEY_BTN"])
        await asyncio.sleep(3)

        key = await get_text_first_visible(page, _S["EXTRACT_SPAN"])
        if key:
            await validate_and_save_to_dashboard(key, provider, email)
        return key
    except Exception as e:
        emit_error(provider, e); return ""
