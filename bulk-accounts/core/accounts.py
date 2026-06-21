"""Account loaders (txt / json)."""
from __future__ import annotations

import json

from .emit import Emit


class AccountLoader:
    @staticmethod
    def from_txt(path: str) -> list[dict]:
        accounts = []
        global_password = None
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                
                if line.lower().startswith("password:"):
                    global_password = line.split(":", 1)[1].strip()
                    continue

                if ":" in line:
                    parts = line.split(":", 1)
                elif " " in line:
                    parts = line.split(None, 1)
                else:
                    parts = [line]

                if len(parts) == 2:
                    email, password = parts[0].strip(), parts[1].strip()
                elif len(parts) == 1 and global_password:
                    email, password = parts[0].strip(), global_password
                else:
                    Emit.call({"type": "warn", "message": f"Skipping unrecognized line: {line}"})
                    continue

                if "@" not in email:
                    Emit.call({"type": "warn", "message": f"Skipping invalid email: {email}"})
                    continue
                    
                accounts.append({"email": email, "password": password})
        return accounts

    @staticmethod
    def from_json(path: str) -> list[dict]:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            raise ValueError("JSON file must be a list of {email, password} objects")
        validated = []
        for i, entry in enumerate(data):
            if not isinstance(entry, dict):
                Emit.call({"type": "warn", "message": f"Skipping non-dict entry at index {i}"})
                continue
            email = entry.get("email", "").strip()
            password = entry.get("password", "").strip()
            if not email or "@" not in email:
                Emit.call({"type": "warn", "message": f"Skipping entry with invalid email at index {i}"})
                continue
            if not password:
                Emit.call({"type": "warn", "message": f"Skipping entry with empty password: {email}"})
                continue
            validated.append({"email": email, "password": password, **{k: v for k, v in entry.items() if k not in ("email", "password")}})
        return validated


class AccountSaver:
    @staticmethod
    def save_json(path: str, accounts: list[dict], backup_dir: str | None = None) -> None:
        from pathlib import Path
        import time
        
        target = Path(path)
        if backup_dir and target.exists():
            ts = int(time.time())
            bdir = Path(backup_dir)
            bdir.mkdir(parents=True, exist_ok=True)
            backup_path = bdir / f"backup-{target.name}-{ts}"
            try:
                backup_path.write_text(target.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception as e:
                from .emit import Emit
                Emit.call({"type": "warn", "message": f"Failed to backup {target.name}: {e}"})

        tmp_path = target.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(accounts, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_path.replace(target)
