from __future__ import annotations

import asyncio
import random
import time
from typing import Any
from faker import Faker

from core.config import Config
from core.selectors import SELECTORS
from .base import emit_progress, emit_error
from .google import handle_google_flow, handle_google_account_chooser, is_google_consent_screen, handle_google_consent
from .utils import (
    click_first_visible,
    fill_first_visible,
    safe_goto,
    fake_key_name
)

_S = SELECTORS["deno"]
fake = Faker()

async def harvest(page: Any, email: str, password: str, provider: str = "deno") -> str:
    emit_progress(provider, "navigate", "Starting Deno harvest flow...")
    try:
        # 1. Login Flow (Reuse session if possible)
        await safe_goto(page, _S["URL_WELCOME"])
        await asyncio.sleep(2)
        
        if await page.query_selector(_S["LOGIN_GOOGLE"]):
            await click_first_visible(page, [_S["LOGIN_GOOGLE"]])
            await asyncio.sleep(3)
            
            if "accounts.google.com" in page.url:
                if not await handle_google_flow(page, email, password): return ""
                await asyncio.sleep(3)
                await handle_google_account_chooser(page, email)
                if await is_google_consent_screen(page):
                    await handle_google_consent(page)
                await asyncio.sleep(5)

        # 2. Accept TOS if present
        if await page.query_selector(_S["TOS_CHECKBOX"]):
            emit_progress(provider, "tos", "Accepting Deno TOS...")
            await page.click(_S["TOS_CHECKBOX"])
            await asyncio.sleep(1)
            await page.click(_S["TOS_CONTINUE"])
            await asyncio.sleep(5)

        # 3. Create Organization if needed
        create_org = await page.query_selector(_S["CREATE_ORG_BTN"])
        if create_org:
            emit_progress(provider, "org", "Creating Deno organization...")
            await create_org.click()
            await asyncio.sleep(5)

        # 4. Extract Organization Domain
        org_name_el = await page.query_selector(_S["ORG_NAME_SPAN"])
        if not org_name_el:
            # Maybe already in dashboard, try to find org name elsewhere or just continue
            emit_progress(provider, "info", "Could not find org name span, continuing...")
            org_domain = f"{email.split('@')[0].replace('.', '-')}.deno.net"
        else:
            raw_name = await org_name_el.inner_text()
            org_domain = f"{raw_name.strip().lower()}.deno.net"
        
        emit_progress(provider, "info", f"Org Domain: {org_domain}")

        # 5. Create Token
        emit_progress(provider, "token", "Navigating to Settings to create token...")
        await click_first_visible(page, [_S["SETTINGS_LINK"]])
        await asyncio.sleep(3)
        
        await click_first_visible(page, [_S["ADD_TOKEN_BTN"]])
        await asyncio.sleep(2)
        
        token_desc = fake.sentence(nb_words=3)
        await fill_first_visible(page, [_S["TOKEN_DESC"]], token_desc)
        
        # Select Expiry: Never (value="0")
        await page.select_option(_S["TOKEN_EXPIRY_SELECT"], value="0")
        await asyncio.sleep(3)
        
        await click_first_visible(page, [_S["CREATE_TOKEN_SUBMIT"]])
        await asyncio.sleep(3)
        
        # Extract Token
        token_el = await page.query_selector(_S["TOKEN_RESULT_CODE"])
        if not token_el:
            emit_error(provider, "Failed to find generated token element")
            return ""
        
        deno_token = await token_el.inner_text()
        deno_token = deno_token.strip()
        emit_progress(provider, "tokens", f"Deno Token extracted: {deno_token[:8]}***")

        # 6. Deploy Relay to Local Dashboard
        emit_progress(provider, "deploy", "Deploying Relay to local dashboard...")
        await safe_goto(page, _S["URL_PROXY_POOLS"])
        await asyncio.sleep(3)
        
        await click_first_visible(page, [_S["DEPLOY_RELAY_BTN"]])
        await asyncio.sleep(1)
        await click_first_visible(page, [_S["DENO_RELAY_OPTION"]])
        await asyncio.sleep(2)
        
        # Fill Form
        await fill_first_visible(page, [_S["INPUT_TOKEN"]], deno_token)
        await fill_first_visible(page, [_S["INPUT_DOMAIN"]], org_domain)
        
        relay_name = f"deno-{fake.domain_word()}-{random.randint(100, 999)}"
        await fill_first_visible(page, [_S["INPUT_RELAY_NAME"]], relay_name)
        
        await click_first_visible(page, [_S["DEPLOY_SUBMIT"]])
        emit_progress(provider, "deploy_wait", "Waiting for deployment validation...")
        await asyncio.sleep(7)
        
        # Validate Deployment
        success_indicator = f"p:has-text('{relay_name}')"
        if await page.query_selector(success_indicator):
            emit_progress(provider, "success", f"Relay '{relay_name}' deployed successfully!")
            return f"{deno_token} | {org_domain} | {relay_name}"
        else:
            emit_error(provider, f"Relay '{relay_name}' deployment could not be verified in UI")
            return f"{deno_token} | {org_domain} (Deploy Status Unknown)"

    except Exception as e:
        emit_error(provider, e)
        return ""
