"""Checkpoint / resume."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from .config import Config
from .emit import Emit


class CheckpointManager:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.data: dict = {"completed": {}, "total_keys": 0}
        self.lock = asyncio.Lock()

    @property
    def _path(self) -> Path:
        return self.output_dir / Config.CHECKPOINT_FILE

    def load(self) -> dict:
        path = self._path
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as _e:
                logging.warning(f'Swallowed exception: {_e}')
        return self.data

    def _deduplicate_keys(self) -> None:
        """Remove duplicate API keys from checkpoint data.
        
        Deduplication is based on provider + email + key_hash to prevent
        storing the same key multiple times when accounts are re-harvested.
        """
        if "completed" not in self.data:
            return
            
        seen_keys = set()
        deduplicated = {}
        
        for email, account_data in self.data["completed"].items():
            if "api_keys" not in account_data:
                deduplicated[email] = account_data
                continue
                
            unique_keys = {}
            for provider, key in account_data["api_keys"].items():
                # Create hash for deduplication: provider + email + first 20 chars of key
                key_hash = f"{provider}:{email}:{key[:20] if key else ''}"
                
                if key_hash not in seen_keys and key:  # Only add if not seen and key is not empty
                    seen_keys.add(key_hash)
                    unique_keys[provider] = key
                    
            account_data["api_keys"] = unique_keys
            deduplicated[email] = account_data
            
        self.data["completed"] = deduplicated

    async def save(self) -> None:
        self._deduplicate_keys()  # Remove duplicate keys before saving
        path = self._path
        tmp = path.with_suffix(".tmp")
        
        def _write():
            tmp.write_text(json.dumps(self.data, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
            
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _write)
        except Exception as e:
            Emit.call({"type": "warn", "message": f"Failed to save checkpoint: {e}"})

    def remove(self) -> None:
        path = self._path
        if path.exists():
            try:
                path.unlink()
            except Exception as _e:
                logging.warning(f'Swallowed exception: {_e}')
