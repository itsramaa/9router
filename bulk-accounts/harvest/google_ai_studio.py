from __future__ import annotations

"""
Google AI Studio — harvest Gemini API key.
"""

import asyncio
from typing import Any
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, check_already_connected
from .google_session import ensure_google_session
from .dashboard import validate_and_save_to_dashboard
from .utils import (
    click_first_visible,
    fill_first_visible,
    fake_key_name,
    safe_goto,
    js_scan_for_key,
)

_S = SELECTORS["gemini"]
URL_API = _S["URL_API"]

def _project_name(key_name: str) -> str:
    """33-character project name (max allowed by Google)."""
    return key_name[:33] if len(key_name) > 33 else key_name.ljust(10, "x")

async def harvest(page: Any, email: str, password: str, provider: str = "google_ai_studio") -> str:
    emit_progress(provider, "navigate", "Starting Google AI Studio check...")
    try:
        # Check if already connected
        if await check_already_connected(email, "gemini", "Google AI Studio"):
            return ""

        # Ensure Google session before navigating to AI Studio
        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        await safe_goto(page, URL_API)

        # Accept TOS if present
        await click_first_visible(page, _S["TOS_CHECKBOX"], retry=False, no_interact=True)
        await asyncio.sleep(2)
        await click_first_visible(page, _S["TOS_CONTINUE"], retry=False, no_interact=True)
        await asyncio.sleep(2)

        await click_first_visible(page, _S["DISMISS_BANNER"], retry=False, no_interact=True)

        # Try to create a new key
        emit_progress(provider, "create", "Creating new key...")
        await click_first_visible(page, _S["CREATE_KEY_BTN"])
        await click_first_visible(page, _S["PROJECT_DROPDOWN"])
        await click_first_visible(page, _S["CREATE_PROJECT_OPTION"])
        await fill_first_visible(page, _S["PROJECT_NAME_INPUT"], _project_name(fake_key_name(provider)))
        await click_first_visible(page, _S["PROJECT_CREATE_SUBMIT"])
        await asyncio.sleep(3)

        err_text = await page.evaluate("""() => {
            const c = document.querySelector('.cdk-overlay-container')?.textContent || '';
            return (c.includes('Failed') || c.includes('permission') || c.includes('suspicious')) ? c : null;
        }""")
        if err_text:
            emit_progress(provider, "create_fallback", "Project creation blocked, trying existing project...")
            try:
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.5)
            except Exception:
                pass
            await click_first_visible(page, _S["CREATE_KEY_BTN"])
            await click_first_visible(page, _S["PROJECT_DROPDOWN"])
            picked = await page.evaluate("""
                () => {
                    const opts = Array.from(document.querySelectorAll('mat-option,option'));
                    const first = opts.find(el => {
                        const t = (el.textContent || '').trim().toLowerCase();
                        return t && !t.includes('create') && el.offsetParent !== null;
                    });
                    if (first) { first.click(); return true; }
                    return false;
                }
            """)
            if not picked:
                raise RuntimeError(f"NO_RETRY:creation_failed: {err_text}")
            await asyncio.sleep(1)

        await click_first_visible(page, _S["KEY_CREATE_SUBMIT"])
        await asyncio.sleep(3)

        key = await js_scan_for_key(page, r"AIza[A-Za-z0-9_-]{35,}")
        if key:
            await validate_and_save_to_dashboard(key, "gemini", email)
            return key

        # Fallback: reload API keys page and scan again
        await safe_goto(page, URL_API)
        await asyncio.sleep(3)
        key = await js_scan_for_key(page, r"AIza[A-Za-z0-9_-]{35,}")
        if key:
            await validate_and_save_to_dashboard(key, "gemini", email)
        return key or ""
    except Exception as e:
        if "NO_RETRY" in str(e):
            raise
        emit_error(provider, e)
        return ""
