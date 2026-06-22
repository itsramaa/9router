from __future__ import annotations

"""
dashboard.py — Direct HTTP integration with 9router.

All three public functions now use the 9router HTTP API directly —
no browser navigation required.

  validate_and_save_to_dashboard  POST /api/automation/inject-key
  email_in_connection_list        GET  /api/providers

that still need a logged-in browser session to complete OAuth flows.
"""

import asyncio
import os
from typing import Any

import httpx

from core.config import Config
from core.selectors import SELECTORS as _S
from .base import emit_progress, emit_error, interact_mode
from .utils import click_first_visible, fill_first_visible, safe_goto

# ── Helpers ───────────────────────────────────────────────────────────────────


def _headers(provider: str) -> dict:
    h = {"Content-Type": "application/json"}
    h["Referer"] = f"http://localhost:20128/dashboard/providers/{provider}"
    # Send API key for 9router auth guard (bypasses JWT cookie requirement)
    api_key = os.environ.get("DASHBOARD_API_KEY", "").strip()
    if api_key:
        h["Authorization"] = f"Bearer {api_key}"
    return h


async def validate_and_save_to_dashboard(
    key: str,
    provider: str,
    email: str,
) -> None:
    """Validate key then save to 9router dashboard."""
    try:
        emit_progress(
            provider,
            "dashboard",
            f"Injecting key {provider} to 9router via API...",
        )

        is_valid_key = "unknown"

        # =========================
        # Validate Key
        # =========================
        validate_payload = {
            "provider": provider,
            "key": key,
            "email": email,
            "name": email,
        }

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{Config.DASHBOARD_BASE_URL}/api/providers/validate",
                json=validate_payload,
                headers=_headers(provider),
            )

        if resp.status_code == 200:
            data = resp.json()
            if data.get("valid"):
                emit_progress(
                    provider,
                    "dashboard",
                    "✓ Key Valid",
                )
                is_valid_key = "true"
            else:
                emit_progress(
                    provider,
                    "warn",
                    f"Validation key returned error: {data.get('error')}",
                )
                is_valid_key = "false"
        else:
            emit_progress(
                provider,
                "error",
                f"Validation key: HTTP {resp.status_code}",
            )

        # =========================
        # Build Save Payload
        # =========================
        if provider == "kiro":
            endpoint = "/api/oauth/kiro/import"
            save_payload = {
                "name": email,
                "refreshToken": key,
            }
        else:
            endpoint = "/api/providers"
            save_payload = {
                "name": email,
                "provider": provider,
                "apiKey": key,
                "priority": 1,
                "proxyPoolId": None,
                "testStatus": is_valid_key,
            }

        # =========================
        # Save Key
        # =========================
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{Config.DASHBOARD_BASE_URL}{endpoint}",
                json=save_payload,
                headers=_headers(provider),
            )

        if resp.status_code != 200:
            emit_progress(
                provider,
                "error",
                f"Save key failed: HTTP {resp.status_code}",
            )
            return

        data = resp.json()

        if provider == "kiro":
            if data.get("success"):
                emit_progress(
                    provider,
                    "dashboard",
                    f"✓ Save {provider} credentials for {email} successfully",
                )
            else:
                emit_progress(
                    provider,
                    "warn",
                    f"Save failed: {data.get('error')}",
                )

        else:
            connection = data.get("connection", {})

            if connection.get("isActive"):
                emit_progress(
                    provider,
                    "dashboard",
                    f"✓ Save {provider} credentials for {email} successfully",
                )
            else:
                emit_progress(
                    provider,
                    "warn",
                    f"Save failed: {data.get('error')}",
                )

    except httpx.ConnectError:
        emit_progress(
            provider,
            "warn",
            f"Cannot connect to {Config.DASHBOARD_BASE_URL} — is 9router running?",
        )

    except Exception as e:
        emit_progress(
            provider,
            "warn",
            f"validate_and_save_to_dashboard failed: {e}",
        )


async def email_in_connection_list(
    email: str,
    provider: str = "",
) -> bool:
    """
    Check whether an email already exists in 9router.

    - Case-insensitive.
    - Trims whitespace on both sides.
    - Checks both email and name fields.
    - Scopes search to a specific provider when provided.
    - Handles null/missing fields safely.
    """

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{Config.DASHBOARD_BASE_URL}/api/providers",
                headers=_headers(provider),
            )

        if resp.status_code != 200:
            emit_progress(
                "dashboard",
                "warn",
                f"Failed to fetch providers: HTTP {resp.status_code}",
            )
            return False

        data = resp.json()

        connections = data.get("connections") or []

        if not isinstance(connections, list):
            emit_progress(
                "dashboard",
                "warn",
                "Invalid providers response: connections is not a list",
            )
            return False

        normalized_email = email.strip().lower()

        normalized_provider = provider.strip().lower() if provider else ""

        if normalized_provider:
            connections = [
                connection
                for connection in connections
                if (
                    (connection.get("provider") or "").strip().lower()
                    == normalized_provider
                )
            ]

        found = any(
            normalized_email == (connection.get("email") or "").strip().lower()
            or normalized_email == (connection.get("name") or "").strip().lower()
            for connection in connections
        )

        emit_progress(
            "dashboard",
            "check_email",
            (
                f"Email {normalized_email} already exists "
                f"in 9router ({normalized_provider or 'any'}): {found}"
            ),
        )

        return found

    except httpx.TimeoutException:
        emit_progress(
            "dashboard",
            "warn",
            "Timeout while checking existing connections",
        )
        return False

    except httpx.HTTPError as e:
        emit_progress(
            "dashboard",
            "warn",
            f"HTTP error while checking existing connections: {e}",
        )
        return False

    except Exception as e:
        emit_progress(
            "dashboard",
            "warn",
            f"email_in_connection_list failed: {e}",
        )
        return False
