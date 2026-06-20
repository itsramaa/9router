from __future__ import annotations

"""Google AI Studio — harvest Gemini API key. Referensi: bulk-accounts/selector.html"""

import asyncio
import json
import logging
import random
import time
from typing import Any

from core.config import Config
from core.selectors import SELECTORS
from .base import emit_progress, emit_error
from .google import handle_google_flow, handle_google_account_chooser, is_google_consent_screen, handle_google_consent
from .dashboard import validate_and_save_to_dashboard, email_in_connection_list, dashboard_login
from .utils import (
    click_first_visible,
    fill_first_visible,
    copy_via_hook,
    fake_key_name,
    safe_goto,
)

_S = SELECTORS["gemini"]
URL_WELCOME = _S["URL_WELCOME"]
URL_API = _S["URL_API"]

def _fake_key_name_for_project(key_name: str) -> str:
    """33-character project name (max allowed by Google)."""
    return key_name[:33] if len(key_name) > 33 else key_name.ljust(10, "x")

async def _wait_for_page_ready(page: Any, timeout: float = 10.0) -> str:
    """Returns 'tos', 'table', or 'unknown'. Handles welcome redirect."""
    deadline = time.monotonic() + timeout
    tos_sels = json.dumps(_S["TOS_CHECKBOX"] + _S["TOS_CONTINUE"] + ["ms-tos-dialog"])
    table_sels = json.dumps(_S["CREATE_KEY_BTN"] + ["ms-api-key-table", "ms-api-keys"])

    while time.monotonic() < deadline:
        url = page.url
        if "aistudio.google.com/welcome" in url or "aistudio.google.com/app/home" in url:
            await safe_goto(page, URL_API)
            await asyncio.sleep(3)
            continue
        if "accounts.google.com" in url:
            return "needs_login"
        has_tos = await page.evaluate(f"() => {{ const sels = {tos_sels}; for (const sel of sels) {{ try {{ const el = document.querySelector(sel); if (el && el.offsetParent !== null) return true; }} catch(e) {{}} }} return false; }}")
        if has_tos: return "tos"
        has_table = await page.evaluate(f"() => {{ const sels = {table_sels}; for (const sel of sels) {{ try {{ const el = document.querySelector(sel); if (el && el.offsetParent !== null) return true; }} catch(e) {{}} }} return false; }}")
        if has_table: return "table"
        await asyncio.sleep(0.5)
    return "unknown"

async def harvest(page: Any, email: str, password: str, provider: str = "google_ai_studio") -> str:
    emit_progress(provider, "navigate", "Starting Google AI Studio check...")
    try:
        dp = "gemini"
        await safe_goto(page, f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/{dp}")
        await asyncio.sleep(3)
        if await email_in_connection_list(page, email):
            return f"Already connected ({email})"

        await safe_goto(page, URL_API)

        await click_first_visible(page, _S["TOS_CHECKBOX"])
        await asyncio.sleep(2)
        await click_first_visible(page, _S["TOS_CONTINUE"])
        await asyncio.sleep(2)

        await click_first_visible(page, _S["DISMISS_BANNER"], retry=False, no_interact=True)
        key = await copy_via_hook(page, click_first_visible(page, _S["COPY_KEY_BTN"], retry=False, no_interact=True))
        if key and ".." not in key:
            await validate_and_save_to_dashboard(page, key, "gemini" if provider == "google_ai_studio" else provider, email)
            return key

        emit_progress(provider, "create", "Creating new key...")
        await click_first_visible(page, _S["CREATE_KEY_BTN"])
        await click_first_visible(page, _S["PROJECT_DROPDOWN"])
        await click_first_visible(page, _S["CREATE_PROJECT_OPTION"])
        await fill_first_visible(page, _S["PROJECT_NAME_INPUT"], _fake_key_name_for_project(fake_key_name(provider)))
        await click_first_visible(page, _S["PROJECT_CREATE_SUBMIT"])
        await asyncio.sleep(3)

        err_text = await page.evaluate("""() => {
            const c = document.querySelector('.cdk-overlay-container')?.textContent || '';
            return (c.includes('Failed') || c.includes('permission') || c.includes('suspicious')) ? c : null;
        }""")
        if err_text:
            emit_progress(provider, "create_fallback", "Project creation blocked, trying existing project...")
            # Dismiss overlay and try picking an existing project instead
            try:
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.5)
            except Exception: pass
            await click_first_visible(page, _S["CREATE_KEY_BTN"])
            await click_first_visible(page, _S["PROJECT_DROPDOWN"])
            # Try to pick any existing (non-create) option
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
        key = await copy_via_hook(page, click_first_visible(page, _S["DIALOG_COPY_KEY"], retry=False, no_interact=True))
        if key and ".." not in key:
            await validate_and_save_to_dashboard(page, key, "gemini" if provider == "google_ai_studio" else provider, email)
            return key

        await safe_goto(page, URL_API)
        await asyncio.sleep(3)
        key = await copy_via_hook(page, click_first_visible(page, _S["COPY_KEY_BTN"], retry=False, no_interact=True))
        if key and ".." not in key:
            await validate_and_save_to_dashboard(page, key, "gemini" if provider == "google_ai_studio" else provider, email)
            return key
        return ""
    except Exception as e:
        if "NO_RETRY" in str(e): raise
        emit_error(provider, e); return ""
