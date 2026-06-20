from __future__ import annotations
import asyncio
import json
import logging
import time
from typing import Any
from core.config import Config
from core.selectors import SELECTORS as _S
from .base import emit, _GOOGLE_DOMAINS, _AUTH_PATHS, interact_mode
from .utils import click_first_visible, safe_goto

async def handle_google_account_chooser(page: Any, email: str) -> bool:
    """Klik akun yang cocok di Google account chooser."""
    try:
        url_lower = page.url.lower()
        if "accounts.google.com" not in url_lower:
            return False

        chooser_patterns = ["accountchooser", "oauthchooseaccount", "selectaccount", "/chooser"]
        if not any(p in url_lower for p in chooser_patterns):
            return False

        sels = json.dumps(_S["google_login"]["ACCOUNT_CHOOSER"])
        result = await page.evaluate(
            """async (targetEmail) => {
                const norm = String(targetEmail || '').trim().toLowerCase();
                const blocked = ['use another account','gunakan akun lain','add account'];
                const isVis = el => el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
                const walk = el => String(el?.innerText || el?.textContent || '').trim();
                const candidates = Array.from(document.querySelectorAll(SELS)).filter(el => {
                    if (!isVis(el)) return false;
                    const txt = walk(el).toLowerCase();
                    return !blocked.some(b => txt.includes(b));
                });
                for (const el of candidates) {
                    const id = (el.getAttribute('data-identifier') || el.getAttribute('data-email') || '').toLowerCase();
                    const txt = walk(el).toLowerCase();
                    if (id === norm || txt.includes(norm)) {
                        if (el.dataset.clicked) return true;
                        el.scrollIntoView({ block: 'center' });
                        await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
                        el.click();
                        return true;
                    }
                }
                if (candidates.length === 1) {
                    const el = candidates[0];
                    if (el.dataset.clicked) return true;
                    el.dataset.clicked = 'true';
                    await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
                    el.click();
                    return true;
                }
                return false;
            }""".replace("SELS", sels),
            email,
        )
        return bool(result)
    except Exception:
        return False

async def is_google_consent_screen(page: Any) -> bool:
    """Instant check to see if we are on the OAuth consent screen."""
    try:
        await asyncio.sleep(3)
        if "accounts.google.com" not in page.url:
            return False
        sels = json.dumps(_S["google_login"]["CONSENT_BTNS"])
        return bool(await page.evaluate(f"""() => {{
            for (const sel of {sels}) {{
                try {{
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }} catch(e) {{}}
            }}
            return false;
        }}"""))
    except Exception:
        return False

async def handle_google_consent(page: Any, timeout: float = 15000) -> bool:
    """Handle Google consent / TOS screen."""
    try:
        await asyncio.sleep(3)
        return await click_first_visible(page, _S["google_login"]["CONSENT_BTNS"], timeout=timeout, no_interact=True)
    except Exception:
        return False

async def is_google_email_step(page: Any) -> bool:
    try:
        sels = json.dumps(_S["google_login"]["EMAIL_INPUT"])
        return bool(await page.evaluate(f"""() => {{
            for (const sel of {sels}) {{
                try {{
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }} catch(e) {{}}
            }}
            return false;
        }}"""))
    except Exception:
        return False

async def is_google_password_step(page: Any) -> bool:
    try:
        sels = json.dumps(_S["google_login"]["PASSWORD_INPUT"])
        return bool(await page.evaluate(f"""() => {{
            for (const sel of {sels}) {{
                try {{
                    const el = document.querySelector(sel);
                    if (el && el.offsetParent !== null) return true;
                }} catch(e) {{}}
            }}
            return false;
        }}"""))
    except Exception:
        return False

async def fill_google_email(page: Any, email: str) -> bool:
    """Fill email field on Google sign-in."""
    email_sels = _S["google_login"]["EMAIL_INPUT"]
    next_sels = _S["google_login"]["EMAIL_NEXT_BTN"]
    for sel in email_sels:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0 or not await loc.is_visible(): continue
            await loc.scroll_into_view_if_needed()
            await asyncio.sleep(1)
            await loc.click(force=True)
            await asyncio.sleep(0.1)
            try:
                await loc.press("Control+a")
                await loc.press("Backspace")
            except Exception: pass
            await loc.press_sequentially(email, delay=30)
            await asyncio.sleep(0.3)
            if email.lower() != str(await loc.input_value()).lower().strip(): continue

            clicked = bool(await page.evaluate("""() => {
                const btn = document.querySelector('#identifierNext button,#identifierNext');
                if (btn && btn.offsetParent !== null) {
                    if (btn.dataset.clicked) return true;
                    btn.dataset.clicked = 'true';
                    return new Promise(r => { setTimeout(() => { btn.click(); r(true); }, 800 + Math.random() * 500); });
                }
                return false;
            }"""))
            if not clicked:
                try:
                    await loc.press("Enter")
                    clicked = True
                except Exception: pass
            if not clicked:
                await click_first_visible(page, next_sels, no_interact=True)
            await asyncio.sleep(1)
            return True
        except Exception: continue
    return False

async def fill_google_password(page: Any, password: str) -> bool:
    """Fill password field on Google sign-in."""
    password_sels = _S["google_login"]["PASSWORD_INPUT"]
    next_sels = _S["google_login"]["PASSWORD_NEXT_BTN"]
    sels_json = json.dumps(next_sels)

    for sel in password_sels:
        try:
            loc = page.locator(sel).first
            if await loc.count() == 0 or not await loc.is_visible(): continue
            await loc.scroll_into_view_if_needed()
            await asyncio.sleep(1)
            await loc.click(force=True)
            await asyncio.sleep(0.1)
            try:
                await loc.press("Control+a")
                await loc.press("Backspace")
            except Exception: pass
            await loc.press_sequentially(password, delay=35)
            await asyncio.sleep(0.3)
            if len(str(await loc.input_value())) < len(password): continue

            clicked = bool(await page.evaluate(f"""() => {{
                let btn = null;
                for (const sel of {sels_json}) {{
                    try {{ btn = document.querySelector(sel); if (btn && btn.offsetParent !== null) break; }} catch(e) {{}}
                }}
                if (btn && btn.offsetParent !== null) {{
                    if (btn.dataset.clicked) return true;
                    btn.dataset.clicked = 'true';
                    return new Promise(r => {{ setTimeout(() => {{ btn.click(); r(true); }}, 800 + Math.random() * 500); }});
                }}
                return false;
            }}"""))
            if not clicked:
                try:
                    await loc.press("Enter"); clicked = True
                except Exception: pass
            if not clicked:
                await click_first_visible(page, next_sels, no_interact=True)
            await asyncio.sleep(3)
            return True
        except Exception: continue
    return False

async def handle_google_flow(page: Any, email: str, password: str, timeout: float = 90.0) -> bool:
    """Combined Google Login & Consent flow helper."""
    deadline = time.monotonic() + timeout
    last_step = ""
    speedbump_sels = _S["google_login"]["SPEEDBUMP_BTNS"]

    while time.monotonic() < deadline:
        try:
            url = page.url
        except Exception: return False

        if not any(d in url for d in _GOOGLE_DOMAINS) and url.startswith("http"):
            return True

        if "/speedbump" in url:
            await click_first_visible(page, speedbump_sels, no_interact=True, retry=False)
            await asyncio.sleep(2); continue

        if "SetSID" in url or "/accounts/set" in url.lower():
            await asyncio.sleep(1); continue

        if await handle_google_account_chooser(page, email):
            await asyncio.sleep(3); continue

        if await is_google_consent_screen(page):
            await handle_google_consent(page); await asyncio.sleep(3); continue

        if await is_google_email_step(page) and not await is_google_password_step(page):
            if last_step != "email":
                last_step = "email"
                await fill_google_email(page, email)
            await asyncio.sleep(2); continue

        if await is_google_password_step(page):
            if last_step != "password":
                last_step = "password"
                await fill_google_password(page, password)
            await asyncio.sleep(3); continue

        if any(p in url for p in ["/challenge/", "/signin/rejected", "/signin/blocked"]):
            await asyncio.sleep(2)
            try: await page.go_back(); await asyncio.sleep(2)
            except Exception: pass
            continue
        await asyncio.sleep(1)
    return False

async def retry_google_login(page: Any, email: str, password: str, login_url: str, google_btn_selectors: list[str], max_retries: int = 2, timeout: float = 90.0) -> bool:
    """Retry wrapper untuk Google OAuth login."""
    try:
        await safe_goto(page, login_url); await asyncio.sleep(1)
    except Exception: pass

    for attempt in range(max_retries):
        if attempt > 0:
            emit({"type": "progress", "step": "login_retry", "message": f"Login retry {attempt}/{max_retries - 1}..."})
            try: await safe_goto(page, login_url); await asyncio.sleep(1)
            except Exception: pass

        login_domain = login_url.split("/")[2]
        is_auth_page = any(p in page.url for p in _AUTH_PATHS)
        if login_domain in page.url and not is_auth_page and page.url.startswith("http"):
            return True

        if await click_first_visible(page, google_btn_selectors, timeout=15000):
            for _ in range(30):
                await asyncio.sleep(0.5)
                if any(d in page.url for d in _GOOGLE_DOMAINS): break

        if not any(d in page.url for d in _GOOGLE_DOMAINS):
            if login_domain in page.url and not any(p in page.url for p in _AUTH_PATHS):
                return True
            if not any(p in page.url for p in _AUTH_PATHS): continue

        if await handle_google_flow(page, email, password, timeout=timeout):
            return True
        await asyncio.sleep(1)
    return False
