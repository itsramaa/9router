from __future__ import annotations

"""
xAI — harvest provider connection.
"""

import asyncio
from typing import Any
from core.config import Config
from core.selectors import SELECTORS
from .base import emit_progress, emit_error, handle_oauth_popup, check_already_connected, verify_connection_in_dashboard
from .google_session import ensure_google_session
from .utils import (
    click_first_visible,
    get_value_first_visible,
    fill_first_visible,
    safe_goto,
)

_S = SELECTORS["xai"]


async def harvest(page: Any, email: str, password: str, provider: str = "xai") -> str:
    emit_progress(provider, "navigate", "Starting xAI Connection...")
    try:
        # Check if already connected
        if await check_already_connected(email, provider, "xAI"):
            return ""

        emit_progress(provider, "google", "Ensuring Google session...")
        await ensure_google_session(page, email, password)

        url = f"{Config.DASHBOARD_BASE_URL}/dashboard/providers/{provider}"
        await safe_goto(page, url)
        await asyncio.sleep(3)

        for attempt in range(3):
            await click_first_visible(page, _S["ADD_BTN"])

            res = await handle_oauth_popup(
                page,
                email,
                password,
                google_btn_sels=_S["GOOGLE_BTN"],
                authorize_sels=_S["AUTHORIZE_BTN"],
                post_auth_delay=5,
                dont_close=True,
            )
            if isinstance(res, tuple) and res[0]:
                _, extra_page = res
                extracted_code = await get_value_first_visible(
                    extra_page, _S["VALUE"], no_interact=True
                )

                if extracted_code:
                    await fill_first_visible(
                        page, _S["PASTE_CODE_INPUT"], extracted_code, no_interact=True
                    )
                    await asyncio.sleep(3)
                    await click_first_visible(
                        page, _S["SUBMIT_CODE_BTN"], no_interact=True
                    )
                    await asyncio.sleep(3)

                    # Close the popup now that we're done with it
                    try:
                        if not extra_page.is_closed():
                            await extra_page.close()
                    except Exception:
                        pass

                    await verify_connection_in_dashboard(page, email, provider)
                    return ""  # Success for log_only provider

            if attempt < 2:
                emit_progress(
                    provider, "retry", f"Retrying (attempt {attempt + 2}/3)..."
                )
                await click_first_visible(
                    page, _S["CANCEL_BTN"], no_interact=True, retry=False
                )
                await asyncio.sleep(3)
        return ""
    except Exception as e:
        emit_error(provider, e)
        return ""
