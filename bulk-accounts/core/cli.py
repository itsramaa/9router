"""Shared CLI argument parsing and account loading logic."""
from __future__ import annotations

import sys
from pathlib import Path

from core.accounts import AccountLoader
from core.config import Config


def load_accounts(args) -> list[dict]:
    """Load accounts based on CLI arguments."""
    if args.email and args.password:
        return [{"email": args.email, "password": args.password}]

    if hasattr(args, "file") and args.file:
        path = Path(args.file)
        if not path.exists():
            print(f"  ✗ File not found: {path}", flush=True)
            return []
        return AccountLoader.from_txt(str(path))

    acc_path = getattr(args, "accounts", "accounts.json")
    path = Path(acc_path)
    if not path.exists():
        alt = Path(__file__).parent.parent / acc_path
        if alt.exists():
            path = alt
        else:
            print(f"  ✗ Accounts file not found: {acc_path}", flush=True)
            return []
    return AccountLoader.from_json(str(path))


def validate_providers(providers_str: str) -> list[str]:
    """Validate and return list of provider keys."""
    if providers_str.lower() == "all":
        return Config.ALL_PROVIDERS

    providers = [p.strip().lower() for p in providers_str.split(",") if p.strip()]
    invalid = [p for p in providers if p not in Config.PROVIDER_REGISTRY]
    if invalid:
        print(f"  ⚠ Unknown providers (skipped): {invalid}. Valid: {Config.ALL_PROVIDERS}", flush=True)
    valid = [p for p in providers if p in Config.PROVIDER_REGISTRY]
    if not valid:
        print(f"  ✗ No valid providers specified.", flush=True)
    return valid
