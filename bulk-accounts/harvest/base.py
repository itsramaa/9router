from __future__ import annotations
"""
harvest/base.py — Core shared logic and constants for providers.
"""

import asyncio
from typing import Any
from core.context import _email as _current_email, _slot as _current_slot
from core.emit import Emit

_GOOGLE_DOMAINS: tuple[str, ...] = (
    "accounts.google.com", "accounts.google.co.id", "accounts.google.co.uk",
    "accounts.google.com.au", "accounts.google.ca", "accounts.google.de",
    "accounts.google.fr", "accounts.google.co.jp", "accounts.google.co.jp", "accounts.google.co.in",
)

_AUTH_PATHS: tuple[str, ...] = (
    "/login", "/signin", "/auth", "/authorize", "/oauth", "/sso",
)

def set_current_email(email: str) -> None:
    _current_email.set(email)

def emit(data: dict) -> None:
    Emit.emit(data)

def emit_progress(provider: str, step: str, message: str) -> None:
    Emit.progress(provider, step, message)

def emit_error(provider: str, error: Any) -> None:
    Emit.error(provider, error)

async def interact_mode(slot: int, page: Any, reason: str, _emit_override=None) -> str:
    from core.interact import InteractMode
    if slot == 0:
        slot = _current_slot.get()
    return await InteractMode.enter(slot, page, reason)

async def handle_oauth_popup(
    page: Any, email: str, password: str, *,
    google_btn_sels: list | None = None,
    authorize_sels: list | None = None,
    skip_sels: list | None = None,
    captcha_prompt: str | None = None,
    captcha_before_popup: bool = False,
    close_new_tab: bool = False,
    post_auth_delay: int = 3,
    timeout: int = 15000,
    **kwargs
) -> bool | tuple[bool, Any]:
    from .utils import click_first_visible, wait_for_turnstile
    from .google import handle_google_account_chooser, is_google_consent_screen, handle_google_consent

    if captcha_prompt and captcha_before_popup:
        # Coba auto-solve Turnstile via Camoufox fingerprint dulu
        turnstile_solved = await wait_for_turnstile(page, timeout=20.0)
        if not turnstile_solved:
            await interact_mode(0, page, captcha_prompt)
        await asyncio.sleep(2)

    # 1. Detect if there's already a popup or wait for one
    extra_page = None
    pages_before = set(page.context.pages)
    
    # Check if a new page was already opened before we even started
    other_pages = [p for p in page.context.pages if p is not page]
    if other_pages:
        extra_page = other_pages[-1]
    else:
        try:
            async with page.context.expect_page(timeout=5000) as page_info:
                # If no popup yet, try clicking google_btn on MAIN page (just in case)
                if google_btn_sels:
                    await click_first_visible(page, google_btn_sels, timeout=2000, no_interact=True)
                extra_page = await page_info.value
        except Exception: pass

    is_popup = extra_page is not None and extra_page is not page
    if not extra_page: extra_page = page

    if is_popup:
        try:
            from core.interact import update_interact_page, get_interact_streamer
            slot = _current_slot.get()
            if slot: update_interact_page(slot, extra_page, get_interact_streamer(slot))
        except Exception: pass
        await asyncio.sleep(2)

    # 2. Click the Google button (could be on main page or INSIDE the popup)
    if google_btn_sels:
        # We click it on the extra_page (which could be the login popup)
        # but only if it's NOT already Google domain
        if not any(d in extra_page.url for d in _GOOGLE_DOMAINS):
            await click_first_visible(extra_page, google_btn_sels, no_interact=True)
            await asyncio.sleep(2)

    if captcha_prompt and not captcha_before_popup:
        # Coba auto-solve Turnstile via Camoufox fingerprint dulu
        turnstile_solved = await wait_for_turnstile(extra_page, timeout=20.0)
        if not turnstile_solved:
            await interact_mode(0, extra_page, captcha_prompt)
        await asyncio.sleep(2)

    if any(d in extra_page.url for d in _GOOGLE_DOMAINS):
        await asyncio.sleep(3)
        for _ in range(5):
            if await handle_google_account_chooser(extra_page, email):
                await asyncio.sleep(3); break
            if await is_google_consent_screen(extra_page): break
            await asyncio.sleep(3)
        if await is_google_consent_screen(extra_page):
            await handle_google_consent(extra_page)
        await asyncio.sleep(post_auth_delay)

    if skip_sels:
        await click_first_visible(extra_page, skip_sels)
    if authorize_sels:
        await asyncio.sleep(3)
        await click_first_visible(extra_page, authorize_sels)

    if (is_popup or close_new_tab) and extra_page is not page and not kwargs.get("dont_close"):
        # If we detected a popup but have no automated flow defined, pause for manual only in interactive mode
        if not google_btn_sels and not authorize_sels and not captcha_prompt:
            from core.config import Config as _Cfg
            if _Cfg.INTERACTIVE_MODE:
                await interact_mode(0, extra_page, "Manually complete the connection in the browser.")

        try:
            if not extra_page.is_closed(): await extra_page.close()
        except Exception: pass
    
    return (True, extra_page)
