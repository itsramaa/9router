from __future__ import annotations
"""
harvest/utils.py — Reusable utilities for all harvest providers.
"""

import logging
import asyncio
import os
import random
import re
import time
from core.config import Config
import string
from typing import Any

from core.context import _slot as _current_slot, _emit_cb as _current_emit
from core.emit import Emit
from core.interact import (
    interact_gate, update_interact_page, get_interact_page, get_interact_streamer
)

DEBUG_LOG = os.getenv("DEBUG") == "1"

try:
    from faker import Faker
    _faker = Faker("en_US")
except ImportError:
    _faker = None

# ── Safe navigation helper ────────────────────────────────────────────────────

async def safe_goto(page: Any, url: str, timeout: int = 30000, idle_timeout: int = 30000, pre_delay: bool = False) -> None:
    if pre_delay:
        await asyncio.sleep(1)
    try:
        await page.goto(url, wait_until="commit", timeout=timeout)
    except Exception as e:
        err_str = str(e).lower()
        # ns_error_unknown_protocol: Firefox/Gecko fails on custom protocols (e.g. kiro://)
        # even when the route handler will intercept it — treat as non-fatal.
        _NAV_ERRORS = ("interrupted", "navigation", "ns_error_unknown_protocol")
        if not any(n in err_str for n in _NAV_ERRORS):
            raise
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=5000)
        await page.wait_for_load_state("networkidle", timeout=idle_timeout)
    except Exception: pass

# ── Fake data generators ──────────────────────────────────────────────────────

def fake_first_name() -> str:
    return _faker.first_name() if _faker else "Alex"

def fake_last_name() -> str:
    return _faker.last_name() if _faker else "Smith"

def fake_username(email: str = "") -> str:
    prefix = re.sub(r"[^a-z0-9]", "", email.split("@")[0].lower())[:8]
    suffix = "".join(random.choices(string.digits, k=4))
    if _faker:
        word = re.sub(r"[^a-z]", "", _faker.word().lower())[:6]
        return f"{word}{prefix}{suffix}"
    return f"{prefix}{suffix}"

def fake_org_name(email: str = "") -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    if _faker:
        slug = re.sub(r"[^a-z0-9]", "", _faker.word().lower())[:8]
        return f"{slug}-{suffix}"
    prefix = email.split("@")[0][:8]
    return f"{prefix}-{suffix}"

def fake_key_name(email: str = "") -> str:
    if _faker:
        word = re.sub(r"[^a-z]", "", _faker.word().lower())[:10]
        suffix = "".join(random.choices(string.digits, k=4))
        return f"{word}-{suffix}"
    suffix = "".join(random.choices(string.digits, k=4))
    prefix = email.split("@")[0][:12] if email else "bulk"
    return f"{prefix}-{suffix}"

# ── Cloudflare Turnstile handler ─────────────────────────────────────────────

async def wait_for_turnstile(page: Any, timeout: float = 20.0) -> bool:
    """
    Tunggu Camoufox auto-solve Cloudflare Turnstile.

    Camoufox spoof fingerprint di C++ level sehingga Turnstile managed/non-interactive
    sering auto-pass tanpa interaksi user. Fungsi ini poll beberapa signal:
      1. iframe challenges.cloudflare.com menghilang → solved
      2. hidden input [name=cf-turnstile-response] punya value → solved
      3. elemen error muncul → failed (bukan auto-solved)

    Returns:
        True  → Turnstile solved (atau tidak ada Turnstile sama sekali)
        False → Timeout, perlu manual intervention
    """
    _TURNSTILE_IFRAME = "iframe[src*='challenges.cloudflare.com']"
    _TURNSTILE_RESPONSE = "[name='cf-turnstile-response']"
    _TURNSTILE_ERROR = ".cf-turnstile-error, [data-error]"

    # Kalau dari awal tidak ada Turnstile, langsung return True
    try:
        count = await page.locator(_TURNSTILE_IFRAME).count()
        if count == 0:
            return True
    except Exception:
        return True

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            # Signal 1: iframe sudah hilang → auto-solved
            count = await page.locator(_TURNSTILE_IFRAME).count()
            if count == 0:
                return True

            # Signal 2: hidden response token sudah ada → solved
            solved = await page.evaluate(f"""() => {{
                // Cek response token di main doc
                const el = document.querySelector("{_TURNSTILE_RESPONSE}");
                if (el && el.value && el.value.length > 10) return true;
                // Cek di semua frame
                try {{
                    for (const f of window.frames) {{
                        const inner = f.document?.querySelector("{_TURNSTILE_RESPONSE}");
                        if (inner && inner.value && inner.value.length > 10) return true;
                    }}
                }} catch {{}}
                return false;
            }}""")
            if solved:
                return True

            # Signal 3: error state → Turnstile detect bot, tidak akan auto-solve
            is_error = await page.evaluate(f"""() => {{
                const el = document.querySelector("{_TURNSTILE_ERROR}");
                return !!el;
            }}""")
            if is_error:
                return False

        except Exception:
            pass
        await asyncio.sleep(1.5)

    return False


# ── Robust selector helpers ───────────────────────────────────────────────────

async def _operate_on_first_visible(
    page: Any,
    selectors: str | list[str],
    operation: str,
    value: str = "",
    timeout: float = 15000,
    force: bool = False,
    retry: bool = True,
    _retrying: bool = False,
    no_interact: bool | None = None,
    interact_reason: str | None = None,
) -> Any:
    """Unified internal helper for click/fill/get_text."""
    # If no_interact not explicitly set, use global config (INTERACTIVE_MODE=False → no_interact=True)
    if no_interact is None:
        no_interact = not Config.INTERACTIVE_MODE
    if not selectors: return False if operation not in ("get_text", "get_value") else ""
    if isinstance(selectors, str): selectors = [selectors]
    if not no_interact: timeout = max(timeout, 15000)

    # 1. Wait/Retry loop for ANY of the selectors to appear (supports frames)
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < (timeout / 1000.0):
        res = await _try_find_and_act(page, selectors, operation, value, force)
        if res is not None: return res
        await asyncio.sleep(1)

    # 2. Sequential check/act (if timeout passed and still nothing, we enter intervention)
    for i, sel in enumerate(selectors):
        res = await _try_find_and_act(page, [sel], operation, value, force)
        if res is not None: return res

        # 2. If not found, enter loop to wait/interact for THIS selector
        while True:
            slot = _current_slot.get()
            if no_interact or not slot: break 

            reason = interact_reason or (f"Selector not found ({i+1}/{len(selectors)}): {sel}")
            active_page = page or get_interact_page(slot)
            update_interact_page(slot, active_page, get_interact_streamer(slot))

            result = await interact_gate(slot, active_page, reason)
            
            if result == "__continue__":
                Emit.call({"type": "log", "message": "Resuming automation: checking all variations..."})
                res = await _try_find_and_act(active_page, selectors, operation, value, force)
                if res is not None: return res
                
                # If still not found, return Success (True or "") to move to the NEXT STEP
                return "" if operation in ("get_text", "get_value") else True

            elif result == "__retry__":
                res = await _try_find_and_act(active_page, [sel], operation, value, force)
                if res is not None: return res
                continue
            elif result == "": 
                return "" if operation in ("get_text", "get_value") else False
            elif result and result not in ("__continue__", "__retry__"): 
                return result
            else:
                Emit.call({"type": "log", "message": "Resuming automation: checking all variations..."})
                res = await _try_find_and_act(active_page, selectors, operation, value, force)
                if res is not None: return res
                return "" if operation in ("get_text", "get_value") else True
    
    return False if operation not in ("get_text", "get_value") else ""

async def _try_find_and_act(target_page, selectors_list: list[str], operation: str, value: str, force: bool):
    for sel in selectors_list:
        locs = [target_page.locator(sel + " >> visible=true").first]
        if hasattr(target_page, "frames"):
            for f in target_page.frames:
                if f != getattr(target_page, "main_frame", None):
                    locs.append(f.locator(sel + " >> visible=true").first)
        for loc in locs:
            try:
                if not await loc.is_visible(): continue
                await loc.scroll_into_view_if_needed()
                await asyncio.sleep(1)
                if operation == "click": await loc.click(force=force)
                elif operation == "fill":
                    await loc.click(force=False)
                    await loc.press("Control+a")
                    await loc.press("Backspace")
                    await loc.fill(value)
                elif operation == "get_text": return (await loc.inner_text() or "").strip()
                elif operation == "get_value": return (await loc.input_value() or "").strip()
                try: await target_page.wait_for_load_state("domcontentloaded", timeout=2000)
                except Exception: pass
                return True
            except Exception: continue
    return None

async def click_first_visible(page: Any, selectors: str | list[str], no_interact: bool | None = None, **kwargs) -> bool:
    return bool(await _operate_on_first_visible(page, selectors, "click", no_interact=no_interact, **kwargs))

async def fill_first_visible(page: Any, selectors: str | list[str], value: str, no_interact: bool | None = None, **kwargs) -> bool:
    return bool(await _operate_on_first_visible(page, selectors, "fill", value=value, no_interact=no_interact, **kwargs))

async def get_text_first_visible(page: Any, selectors: str | list[str], no_interact: bool | None = None, **kwargs) -> str:
    res = await _operate_on_first_visible(page, selectors, "get_text", no_interact=no_interact, **kwargs)
    return res if isinstance(res, str) else ""

async def get_value_first_visible(page: Any, selectors: str | list[str], min_length: int = 1, no_interact: bool | None = None, **kwargs) -> str:
    res = await _operate_on_first_visible(page, selectors, "get_value", no_interact=no_interact, **kwargs)
    if isinstance(res, str) and len(res) >= min_length: return res
    return ""

async def read_clipboard(page: Any) -> str:
    try:
        val = await page.evaluate("async () => { try { return await navigator.clipboard.readText(); } catch { return ''; } }")
        return str(val or "").strip()
    except Exception: return ""

async def copy_via_hook(page: Any, copy_btn_click) -> str:
    """Inject clipboard intercept hooks."""
    try:
        await page.evaluate("""() => {
            window.__capturedClipboard = '';
            try {
                const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
                navigator.clipboard.writeText = async (text) => {
                    window.__capturedClipboard = text || '';
                    try { await origWrite(text); } catch {}
                };
            } catch {}
        }""")
    except Exception: pass
    if asyncio.iscoroutine(copy_btn_click): await copy_btn_click
    await asyncio.sleep(2)
    try:
        val = await page.evaluate("window.__capturedClipboard || ''")
        return val
    except Exception: return ""

async def js_scan_for_key(page: Any, pattern: str | None = None, min_len: int = 20) -> str:
    pat = pattern or ("[a-zA-Z0-9_\\\\-]{" + str(min_len) + ",}")
    js = """() => {
        for (const el of document.querySelectorAll('input[readonly], input[type="text"]')) {
            const v = (el.value || '').trim();
            if (v.length >= MINLEN) return v;
        }
        const m = (document.innerText || document.textContent || '').match(/PATTERN/);
        return m ? m[0] : null;
    }""".replace("MINLEN", str(min_len)).replace("PATTERN", pat)
    try:
        val = await page.evaluate(js)
        return str(val).strip() if val else ""
    except Exception: return ""
