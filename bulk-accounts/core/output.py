"""Output writer."""
from __future__ import annotations

from pathlib import Path

from .config import Config
from .emit import Emit


class OutputWriter:
    @staticmethod
    def save(results: list[dict], output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        lines: list[str] = []
        for pname in Config.ALL_PROVIDERS:
            display = Config.PROVIDER_DISPLAY.get(pname, pname)
            rows = []
            for r in results:
                key = r.get("api_keys", {}).get(pname, "")
                if key:
                    username = r.get("email", "unknown").split("@")[0]
                    rows.append(f"{username}:{key}")
            if rows:
                lines.append(f"\n#======= {display} ======#")
                lines.extend(rows)

        output_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
        Emit.call({"type": "saved", "path": str(output_path),
                   "message": f"Results saved -> {output_path}"})
