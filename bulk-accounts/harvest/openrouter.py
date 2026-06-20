from __future__ import annotations
"""
OpenRouter — harvest API key.
"""

import asyncio
import logging
from typing import Any
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, interact_mode, handle_oauth_popup
from .dashboard import validate_and_save_to_dashboard
from .utils import (
    click_first_visible,
    fill_first_visible,
    get_text_first_visible,
    fake_key_name,
    safe_goto,
    js_scan_for_key,
)

_S = SELECTORS["openrouter"]
URL_KEYS = _S["URL_KEYS"]

async def harvest(page: Any, email: str, password: str, provider: str = "openrouter") -> str:
    emit_progress(provider, "navigate", "Navigating to OpenRouter...")
    try:
        await safe_goto(page, URL_KEYS)
        await click_first_visible(page, _S["CLERK_GOOGLE_BTNS"])
        await asyncio.sleep(3)

        emit_progress(provider, "captcha", "Waiting for user to solve CAPTCHA...")
        ok = await handle_oauth_popup(
            page, email, password,
            captcha_prompt="OpenRouter — Selesaikan CAPTCHA lalu tekan ENTER",
            captcha_before_popup=False,
        )
        if not ok: return ""

        if await click_first_visible(page, _S["LEGAL_CHECKBOX"], retry=False, timeout=5000, no_interact=True):
            await click_first_visible(page, _S["LEGAL_SUBMIT"], retry=False, no_interact=True)
            await asyncio.sleep(3)

        await safe_goto(page, URL_KEYS, pre_delay=True)
        
        if await click_first_visible(page, _S["POPUP"], no_interact=True):
            await asyncio.sleep(2)
            await click_first_visible(page, _S["ONBOARD_CONTINUE"], no_interact=True)
            await asyncio.sleep(2)
            await click_first_visible(page, _S["POPUP_CLOSE"], no_interact=True)
            await safe_goto(page, URL_KEYS, pre_delay=True)

        if not await click_first_visible(page, _S["CREATE_KEY_BTN"], timeout=5000, retry=False, no_interact=True):
            emit_progress(provider, "onboarding", "Create key button not found, trying fallback path...")
            # Route 2: Onboarding/Fallback flow
            await click_first_visible(page, _S["ONBOARD_GAP_BTN"])
            await click_first_visible(page, _S["ONBOARD_COPY_BTN"]) # Copy API key
            await click_first_visible(page, _S["ONBOARD_CONTINUE"])
            await click_first_visible(page, _S["ONBOARD_SKIP"])
            await click_first_visible(page, _S["ONBOARD_FLEX_BTN"])
            await click_first_visible(page, _S["ONBOARD_CONTINUE"])
            await click_first_visible(page, _S["ONBOARD_DASHBOARD"])
        else:
            # Route 1: Standard flow
            await fill_first_visible(page, _S["KEY_NAME_INPUT"], fake_key_name(email))
            await click_first_visible(page, _S["SUBMIT_BTN"])
            await asyncio.sleep(3)

            key = await get_text_first_visible(page, _S["EXTRACT_CODE"], retry=False)
            if key and len(key) >= 15:
                await validate_and_save_to_dashboard(page, key, provider, email)
                return key

        key = await js_scan_for_key(page, r"sk-or-[A-Za-z0-9_-]{15,}")
        if key:
            await validate_and_save_to_dashboard(page, key, provider, email)
        return key
    except Exception as e:
        emit_error(provider, e); return ""