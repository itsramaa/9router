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
    from core.interact import interact_gate
    if slot == 0:
        slot = _current_slot.get()
    return await interact_gate(slot, page, reason)


async def handle_captcha(
    page: Any,
    prompt: str = "Solve CAPTCHA then click Continue",
) -> bool:
    """
    Handle CAPTCHA after OAuth completes.

    Flow:
      1. Try auto-solve via Camoufox fingerprint (wait_for_turnstile)
      2. If auto-solve fails → emit interact_required to UI
      3. User solves CAPTCHA manually in InteractModal, clicks Continue
      4. interact_gate returns "__continue__" → this function returns True

    Returns:
        True  → captcha solved (auto or manual)
        False → user skipped/aborted, or non-interactive mode
    """
    from .utils import wait_for_turnstile

    # Step 1: Try auto-solve via Camoufox anti-detect fingerprint
    emit_progress("captcha", "auto", "Attempting auto-solve via Camoufox...")
    turnstile_solved = await wait_for_turnstile(page, timeout=20.0)
    if turnstile_solved:
        emit_progress("captcha", "solved", "CAPTCHA auto-solved via Camoufox")
        return True

    # Step 2: Auto-solve failed → show interact modal for manual solve
    emit_progress("captcha", "manual", "Auto-solve failed, waiting for manual CAPTCHA solve...")
    result = await interact_mode(0, page, prompt)

    # Step 3: Check user action
    if result in ("__continue__", "__retry__"):
        emit_progress("captcha", "solved", "CAPTCHA manually solved by user")
        return True

    # Non-interactive mode (empty string) or user aborted/skipped
    emit_progress("captcha", "skip", "CAPTCHA not solved (skipped/aborted)")
    return False


async def handle_oauth_popup(
    page: Any, email: str, password: str, *,
    google_btn_sels: list | None = None,
    authorize_sels: list | None = None,
    skip_sels: list | None = None,
    close_new_tab: bool = False,
    post_auth_delay: int = 3,
    timeout: int = 15000,
    **kwargs
) -> bool | tuple[bool, Any]:
    """
    Pure OAuth popup handler — handles Google login only, NO captcha.

    Flow:
      1. Detect/wait for popup tab
      2. Click Google button (on main page or inside popup)
      3. Handle Google account chooser / consent screen
      4. Click skip/authorize buttons if provided
      5. Close popup tab if close_new_tab=True

    For CAPTCHA handling, call handle_captcha() separately AFTER this function.
    """
    from .utils import click_first_visible
    from .google import handle_google_account_chooser, is_google_consent_screen, handle_google_consent

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
        if not any(d in extra_page.url for d in _GOOGLE_DOMAINS):
            await click_first_visible(extra_page, google_btn_sels, no_interact=True)
            await asyncio.sleep(2)

    # 3. Handle Google login flow
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

    # 4. Click skip/authorize buttons (e.g. SKIP_BTN, AUTH_BTN inside popup)
    if skip_sels:
        await click_first_visible(extra_page, skip_sels)
    if authorize_sels:
        await asyncio.sleep(3)
        await click_first_visible(extra_page, authorize_sels)

    # 5. Close popup if requested
    if (is_popup or close_new_tab) and extra_page is not page and not kwargs.get("dont_close"):
        # If no automated flow was defined, pause for manual interaction
        if not google_btn_sels and not authorize_sels:
            from core.config import Config as _Cfg
            if _Cfg.INTERACTIVE_MODE:
                await interact_mode(0, extra_page, "Manually complete the connection in the browser.")

        try:
            if not extra_page.is_closed(): await extra_page.close()
        except Exception: pass
    
    return (True, extra_page)
