"""Provider registry & shared constants."""

from __future__ import annotations


class Config:
    CHECKPOINT_FILE = "progress.json"

    PROVIDER_REGISTRY: dict[str, dict] = {
        "kiro":          {"module": "harvest.kiro",             "fn": "harvest", "display": "Kiro Refresh Token",     "log_only": False, "timeout": 400},
        # 1. Google AI Studio
        # "gemini": {
        #     "module": "harvest.google_ai_studio",
        #     "fn": "harvest",
        #     "display": "Google AI Studio (Gemini)",
        #     "log_only": False,
        # },
        # 2. Local dashboard providers (log_only — fast, no browser nav needed)
        # "antigravity": {"module": "harvest.antigravity",      "fn": "harvest", "display": "Antigravity",             "log_only": True},
        "xai":           {"module": "harvest.xai",              "fn": "harvest", "display": "xAI",                     "log_only": True},
        "qoder":         {"module": "harvest.qoder",            "fn": "harvest", "display": "Qoder",                   "log_only": True},
        # 3. External providers
        "siliconflow":   {"module": "harvest.siliconflow",      "fn": "harvest", "display": "SiliconFlow",             "log_only": False},
        # "cohere":        {"module": "harvest.cohere",           "fn": "harvest", "display": "Cohere",                  "log_only": False},
        "kilo_code": {
            "module": "harvest.kilo_code",
            "fn": "harvest",
            "display": "Kilo Code",
            "log_only": True,
        },
        "openrouter":    {"module": "harvest.openrouter",       "fn": "harvest", "display": "OpenRouter",              "log_only": False},
        "deno":          {"module": "harvest.deno",             "fn": "harvest", "display": "Deno Deploy",            "log_only": False},
    }

    DASHBOARD_BASE_URL = "http://localhost:20128"
    INTERACTIVE_MODE = True
    ALL_PROVIDERS = list(PROVIDER_REGISTRY.keys())
    PROVIDER_DISPLAY = {k: v["display"] for k, v in PROVIDER_REGISTRY.items()}
