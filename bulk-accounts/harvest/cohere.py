from __future__ import annotations
"""
Cohere — harvest API key.
"""

import asyncio
from typing import Any
from core.selectors import SELECTORS
from .base import emit_progress, emit_error
from harvest.base import handle_oauth_popup
from .dashboard import validate_and_save_to_dashboard
from .utils import (
    click_first_visible,
    fill_first_visible,
    get_value_first_visible,
    fake_first_name,
    fake_last_name,
    safe_goto,
    js_scan_for_key,
)

_S = SELECTORS["cohere"]
URL_KEYS = _S["URL_KEYS"]

async def harvest(page: Any, email: str, password: str, provider: str = "cohere") -> str:
    emit_progress(provider, "navigate", "Navigating to Cohere...")
    try:
        await safe_goto(page, URL_KEYS)
        await click_first_visible(page, _S["GOOGLE_BTNS"])
        await asyncio.sleep(3)

        emit_progress(provider, "login", "Waiting for user to login...")
        ok = await handle_oauth_popup(
            page, email, password, post_auth_delay=5
        )
        if not ok: return ""

        # Onboarding check
        if await click_first_visible(page, _S["FIRST_NAME_INPUT"], timeout=5000, retry=False, no_interact=True):
            await fill_first_visible(page, _S["FIRST_NAME_INPUT"], fake_first_name())
            await fill_first_visible(page, _S["LAST_NAME_INPUT"], fake_last_name())
            await click_first_visible(page, _S["SUBMIT_ONBOARDING_1"])
            await asyncio.sleep(2)
            await click_first_visible(page, _S["STUDENT_RADIO"])
            await click_first_visible(page, _S["SUBMIT_ONBOARDING_1"])
            await asyncio.sleep(2)
            await click_first_visible(page, _S["ROLE_OPTION"])
            await click_first_visible(page, _S["KYC_SUBMIT"])
            await asyncio.sleep(3)

        await safe_goto(page, URL_KEYS, pre_delay=True)
        await asyncio.sleep(3)

        await click_first_visible(page, _S["SHOW_KEY_BTN"])
        await asyncio.sleep(3)

        val = await get_value_first_visible(page, _S["VALUE_INPUT"], min_length=20)
        if val:
            await validate_and_save_to_dashboard(page, val, provider, email)
            return val

        key = await js_scan_for_key(page)
        if key:
            await validate_and_save_to_dashboard(page, key, provider, email)
        return key
    except Exception as e:
        emit_error(provider, e); return ""
