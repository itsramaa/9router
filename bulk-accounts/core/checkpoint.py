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

    async def save(self) -> None:
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
