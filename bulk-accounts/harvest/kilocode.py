from __future__ import annotations

"""
Kilo Code — harvest provider connection.

Flow:
  1. Navigate to provider page → click ADD_BTN
  2. OAuth popup opens → Google login
  3. CAPTCHA appears inside popup → auto-solve or manual via InteractModal
  4. After captcha solved → click SKIP_BTN + AUTH_BTN
  5. Close popup → verify connection in dashboard
"""

import asyncio
from typing import Any
from core.config import Config
from core.selectors import SELECTORS
from .base import (
    emit_progress,
    emit_error,
    handle_oauth_popup,
    handle_captcha,
    check_already_connected,
    verify_connection_in_dashboard,
)
from .google_session import ensure_google_session
from .utils import click_first_visible, safe_goto

_S = SELECTORS["kilocode"]


async def harvest(
    page: Any, email: str, password: str, provider: str = "kilocode"
) -> str:
    emit_progress(provider, "navigate", "Starting Kilo Code Connection...")
    try:
        # Check if already connected
        if await check_already_connected(email, provider, "Kilo Code"):
            return ""

        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/{provider}"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if not await click_first_visible(page, _S["ADD_BTN"]):
            return ""
        await asyncio.sleep(2)

        # Step 1: OAuth popup → Google login only (keep popup open, no skip/auth yet)
        ok, extra_page = await handle_oauth_popup(
            page,
            email,
            password,
            google_btn_sels=_S["GOOGLE_BTN"],
            post_auth_delay=5,
            dont_close=True,
        )
        if not ok:
            return ""

        # Step 2: CAPTCHA inside popup → auto-solve or manual via UI
        emit_progress(provider, "captcha", "Waiting for user to solve CAPTCHA...")
        captcha_solved = await handle_captcha(
            extra_page, "Kilo Code — Selesaikan CAPTCHA lalu klik Continue"
        )
        if not captcha_solved:
            emit_progress(provider, "captcha", "CAPTCHA not solved, aborting")
            try:
                if not extra_page.is_closed():
                    await extra_page.close()
            except Exception:
                pass
            return ""

        # Step 3: SKIP_BTN + AUTH_BTN (appear after captcha solved)
        await click_first_visible(extra_page, _S["SKIP_BTN"])
        await asyncio.sleep(2)
        await click_first_visible(extra_page, _S["AUTH_BTN"])
        await asyncio.sleep(2)

        # Step 4: Close popup
        try:
            if not extra_page.is_closed():
                await extra_page.close()
        except Exception:
            pass

        # Step 5: Verify connection in dashboard
        await asyncio.sleep(3)
        await safe_goto(page, url)
        await asyncio.sleep(3)

        await verify_connection_in_dashboard(page, email, provider)
        return ""  # Success for log_only provider
    except Exception as e:
        emit_error(provider, e)
        return ""
