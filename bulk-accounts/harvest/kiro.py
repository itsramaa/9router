from __future__ import annotations
"""
Kiro — harvest access token via PKCE flow.
"""

import asyncio
import base64
import hashlib
import json
import secrets
import uuid
import httpx
from core.config import Config
from typing import Any
from urllib.parse import urlencode, urlparse, parse_qs

from core.selectors import SELECTORS
from .base import emit_progress, emit_error
from harvest.google import (
    is_google_consent_screen,
    handle_google_consent,
    handle_google_account_chooser,
    is_google_email_step,
    fill_google_email,
    is_google_password_step,
    fill_google_password
)
from .utils import safe_goto
from .dashboard import validate_and_save_to_dashboard, email_in_connection_list, dashboard_login

_S = SELECTORS["kiro"]

def _generate_pkce_pair() -> tuple[str, str]:
    code_verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge

def _extract_code_from_url(url: str) -> str | None:
    if not url:
        return None
    
    from urllib.parse import unquote
    decoded_url = unquote(url)
    
    try:
        parsed = urlparse(decoded_url)
        # SUPER STRICT: Must be the kiro:// protocol.
        # HTTPS URLs (like Google login) are ignored even if they mention kiro.kiroAgent.
        if parsed.scheme != "kiro":
            return None
            
        if "kiro.kiroAgent" not in parsed.netloc and "kiro.kiroAgent" not in decoded_url:
            return None

        query = parsed.query
        if not query and "#" in decoded_url:
             query = decoded_url.split("#")[-1]
        
        params = parse_qs(query)
        codes = params.get("code")
        if codes:
            return codes[0]
        return None
    except Exception:
        return None

async def harvest(page: Any, email: str, password: str, provider: str = "kiro") -> str:
    on_response_handler = None
    try:
        await dashboard_login(page)
        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/kiro"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        if await email_in_connection_list(page, email):
            return f"Kiro : Already connected ({email})"
        
        emit_progress(provider, "config", "Preparing Kiro PKCE flow...")
        
        code_verifier, code_challenge = _generate_pkce_pair()
        state_data = {"auth_code": None}

        # 1. Setup Network Interceptors
        def _on_resp(response: Any) -> None:
            if state_data["auth_code"]: return
            try:
                loc = response.headers.get("location", "")
                if loc and "kiro" in loc.lower():
                    pass
                code = _extract_code_from_url(loc)
                if code:
                    state_data["auth_code"] = code
            except Exception: pass

        on_response_handler = _on_resp
        page.on("response", on_response_handler)

        async def _route_handler(route: Any) -> None:
            url = route.request.url
            code = _extract_code_from_url(url)
            if code:
                state_data["auth_code"] = code
                await route.abort() # Silent abort to avoid browser protocol alert
                return
            await route.continue_()

        await page.route("**/*", _route_handler)
        
        # 2. Start OAuth Flow
        auth_url = f"{_S['KIRO_AUTH_BASE']}/login?" + urlencode({
            "idp": "Google",
            "redirect_uri": _S["KIRO_REDIRECT_URI"],
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": str(uuid.uuid4()),
        })

        emit_progress(provider, "login", "Navigating to Kiro/Google...")
        await safe_goto(page, auth_url)

        # 3. INTERACTION LOOP
        emit_progress(provider, "login", "Processing flow (auto-handling Google/Consent)...")
        
        for i in range(120): # Max 120 seconds
            # A. Check if code captured (via Interceptor or Current URL)
            auth_code = state_data["auth_code"] or _extract_code_from_url(page.url)
            if auth_code:
                state_data["auth_code"] = auth_code
                emit_progress(provider, "tokens", f"Code intercepted: {auth_code[:5]}***")
                break
                
            # B. Handle dynamic page states
            cur_url = page.url
            cur_host = urlparse(cur_url).netloc
            
            if "accounts.google.com" in cur_host:
                if await is_google_consent_screen(page):
                    await handle_google_consent(page)
                elif await handle_google_account_chooser(page, email):
                    pass
                elif await is_google_email_step(page) and not await is_google_password_step(page):
                    await fill_google_email(page, email)
                elif await is_google_password_step(page):
                    await fill_google_password(page, password)
            
            # C. Generic 'Continue' clicker (fallback for various consent screens)
            await page.evaluate("""() => {
                const keywords = ['continue','allow','lanjut','next','berikutnya','agree','setuju'];
                for (const btn of document.querySelectorAll('button, div[role="button"], input[type="submit"]')) {
                    const txt = (btn.textContent || btn.value || '').toLowerCase();
                    if (keywords.some(k => txt.includes(k)) && btn.offsetParent !== null) {
                        btn.click();
                        return;
                    }
                }
            }""")

            if i % 10 == 0:
                emit_progress(provider, "wait", f"Waiting for redirect ({i}s)...")
            
            await asyncio.sleep(1.0)

        # 4. Exchange & Save
        final_code = state_data["auth_code"]
        if not final_code:
            emit_error(provider, "Auth timeout: No kiro code received")
            return ""

        # Exchange code for tokens
        emit_progress(provider, "tokens", "Exchanging code for Refresh Token...")
        
        # Exchange code for tokens
        emit_progress(provider, "tokens", "Exchanging code for Refresh Token...")
        
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                _S["KIRO_TOKEN_ENDPOINT"],
                json={
                    "code": final_code,
                    "code_verifier": code_verifier,
                    "redirect_uri": _S["KIRO_REDIRECT_URI"],
                },
                headers={"Content-Type": "application/json"}
            )
            
            if resp.status_code != 200:
                emit_error(provider, f"Exchange failed ({resp.status_code}): {resp.text[:200]}")
                return ""
            
            payload = resp.json()
            
            refresh_token = payload.get("refreshToken")
            profile_arn = payload.get("profileArn") or payload.get("profile_arn")
            
            if not refresh_token:
                emit_error(provider, f"Response missing refreshToken. Full payload: {str(payload)[:200]}")
                return ""

            # Use just the refresh_token (it already contains the signature part)
            # Based on user feedback, adding profile_arn creates an invalid triple-colon format.
            final_token = refresh_token

            # AUTO-IMPORT TO DASHBOARD
            await validate_and_save_to_dashboard(page, final_token, provider, email)

            emit_progress(provider, "success", "Kiro harvested and imported!")
            return final_token

    except Exception as e:
        emit_error(provider, e)
        return ""
    finally:
        # Cleanup
        if on_response_handler:
            try: page.remove_listener("response", on_response_handler)
            except Exception: pass
        try: await page.unroute("**/*")
        except Exception: pass