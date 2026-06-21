"""Provider registry & shared constants."""

from __future__ import annotations


import os as _os


class Config:
    CHECKPOINT_FILE = "progress.json"

    PROVIDER_REGISTRY: dict[str, dict] = {
        # auth_type: authType to store in DB ("oauth" | "apikey" | "access_token")
        # key_field: which DB field the harvested token maps to
        #   "refreshToken" → credentials.refreshToken (used by kiro executor to refresh)
        #   "apiKey"       → credentials.apiKey (standard API key)
        #   "accessToken"  → credentials.accessToken (short-lived token)
        # log_only providers (xai, qoder, kilocode) complete OAuth via the 9router
        # browser UI — they are NOT injected via validate_and_save_to_dashboard.
        "kiro": {
            "module": "harvest.kiro",
            "fn": "harvest",
            "display": "Kiro Refresh Token",
            "log_only": False,
        },
        # # 1. Google AI Studio
        # "gemini": {
        #     "module": "harvest.google_ai_studio",
        #     "fn": "harvest",
        #     "display": "Google AI Studio (Gemini)",
        #     "log_only": False,
        #     "auth_type": "apikey",
        #     "key_field": "apiKey",
        # },
        # 2. Local dashboard providers (log_only — OAuth completed inside 9router UI)
        # "antigravity": {
        #     "module": "harvest.antigravity",
        #     "fn": "harvest",
        #     "display": "Antigravity",
        #     "log_only": True,
        #     "auth_type": "oauth",
        #     "key_field": "accessToken",
        # },
        "xai": {
            "module": "harvest.xai",
            "fn": "harvest",
            "display": "xAI",
            "log_only": True,
        },
        "qoder": {
            "module": "harvest.qoder",
            "fn": "harvest",
            "display": "Qoder",
            "log_only": True,
        },
        # 3. External providers
        "siliconflow": {
            "module": "harvest.siliconflow",
            "fn": "harvest",
            "display": "SiliconFlow",
            "log_only": False,
        },
        # "cohere": {
        #     "module": "harvest.cohere",
        #     "fn": "harvest",
        #     "display": "Cohere",
        #     "log_only": False,
        #     "auth_type": "apikey",
        #     "key_field": "apiKey",
        # },
        "kilocode": {
            "module": "harvest.kilocode",
            "fn": "harvest",
            "display": "Kilo Code",
            "log_only": True,
        },
        "openrouter": {
            "module": "harvest.openrouter",
            "fn": "harvest",
            "display": "OpenRouter",
            "log_only": False,
        },
        # "deno": {
        #     "module": "harvest.deno",
        #     "fn": "harvest",
        #     "display": "Deno Deploy",
        #     "log_only": False,
        #     "auth_type": "apikey",
        #     "key_field": "apiKey",
        # },
    }

    DASHBOARD_BASE_URL = _os.environ.get("DASHBOARD_BASE_URL", "http://localhost:20128")
    INTERACTIVE_MODE = False  # Always False — web UI drives interaction via WS
    ALL_PROVIDERS = list(PROVIDER_REGISTRY.keys())
    PROVIDER_DISPLAY = {k: v["display"] for k, v in PROVIDER_REGISTRY.items()}
