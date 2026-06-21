from __future__ import annotations
"""
OpenRouter — harvest API key.
"""

import asyncio
import logging
from typing import Any
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, interact_mode, handle_oauth_popup, handle_captcha
from .google_session import ensure_google_session
from .dashboard import validate_and_save_to_dashboard, email_in_connection_list
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
        # Skip if already connected
        if await email_in_connection_list(email, provider=provider):
            emit_progress(provider, "skip", f"⏭ Already connected ({email})")
            return ""
        
        # Ensure Google session before triggering Clerk OAuth popup
        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        await safe_goto(page, URL_KEYS)
        await click_first_visible(page, _S["CLERK_GOOGLE_BTNS"])
        await asyncio.sleep(3)

        # Step 1: Pure OAuth (no captcha)
        ok = await handle_oauth_popup(
            page, email, password,
        )
        if not ok:
            return ""

        # Step 2: Handle CAPTCHA separately after OAuth
        emit_progress(provider, "captcha", "Waiting for user to solve CAPTCHA...")
        captcha_solved = await handle_captcha(
            page, "OpenRouter — Selesaikan CAPTCHA lalu klik Continue"
        )
        if not captcha_solved:
            emit_progress(provider, "captcha", "CAPTCHA not solved, aborting")
            return ""

        # Step 3: Continue with next steps
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
                await validate_and_save_to_dashboard(key, provider, email)
                return key

        key = await js_scan_for_key(page, r"sk-or-[A-Za-z0-9_-]{15,}")
        if key:
            await validate_and_save_to_dashboard(key, provider, email)
        return key
    except Exception as e:
        emit_error(provider, e); return ""
