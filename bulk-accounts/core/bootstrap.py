"""Auto-install deps & camoufox browser on first run."""
from __future__ import annotations

import importlib
import logging
import subprocess
import sys
from pathlib import Path


def _patch_playwright_crash() -> None:
    try:
        import playwright
        bundle = Path(playwright.__file__).parent / "driver" / "package" / "lib" / "coreBundle.js"
        if bundle.exists():
            raw = bundle.read_text("utf-8")
            if "if (!pageError.location)" in raw:
                return
            raw = raw.replace(
                "this.addObjectListener(BrowserContext.Events.PageError, (pageError, page) => {",
                "this.addObjectListener(BrowserContext.Events.PageError, (pageError, page) => {\n          if (!pageError.location)\n            return;"
            )
            bundle.write_text(raw, "utf-8")
            print("[bootstrap] Patched Playwright pageError crash.", flush=True)
    except Exception as _e:
        logging.warning(f'Swallowed exception in _patch_playwright_crash: {_e}')


class Bootstrap:
    _THIS_DIR = Path(__file__).resolve().parent.parent

    @classmethod
    def run(cls) -> None:
        if sys.stdout and hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception as _e:
                logging.warning(f'Swallowed exception: {_e}')

        req_file = cls._THIS_DIR / "requirements-harvest.txt"

        missing: list[str] = []
        _CHECKS = {
            "faker":          "faker",
            "camoufox":       "camoufox",
            "playwright":     "playwright",
            "aiohttp":        "aiohttp",
            "browserforge":   "browserforge",
        }
        for pkg, import_name in _CHECKS.items():
            try:
                importlib.import_module(import_name)
            except ImportError:
                missing.append(pkg)

        if missing:
            print(f"[bootstrap] Missing packages: {missing}", flush=True)
            print(f"[bootstrap] Running: pip install -r {req_file}", flush=True)
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(req_file)],
                check=False,
            )
            if result.returncode != 0:
                print("[bootstrap] WARNING: pip install failed. Continuing anyway...", flush=True)
            else:
                print("[bootstrap] Dependencies installed.", flush=True)
        else:
            print("[bootstrap] All dependencies OK.", flush=True)

        _camoufox_ready = False
        try:
            import camoufox.pkgman
            p = camoufox.pkgman.launch_path()
            _camoufox_ready = Path(p).exists() if p else False
        except Exception:
            try:
                import camoufox
                cf_dir = Path(camoufox.__file__).parent
                for pattern in ("**/firefox", "**/firefox.exe", "**/*.app"):
                    if any(cf_dir.glob(pattern)):
                        _camoufox_ready = True
                        break
            except Exception as _e:
                logging.warning(f'Swallowed exception: {_e}')

        if not _camoufox_ready:
            print("[bootstrap] Camoufox browser not found. Downloading...", flush=True)
            result = subprocess.run(
                [sys.executable, "-m", "camoufox", "fetch"],
                check=False,
            )
            if result.returncode != 0:
                print("[bootstrap] WARNING: camoufox fetch failed. Check your internet connection.", flush=True)
            else:
                print("[bootstrap] Camoufox browser ready.", flush=True)
        else:
            print("[bootstrap] Camoufox browser OK.", flush=True)

        try:
            _patch_playwright_crash()
        except Exception as e:
            print(f"[bootstrap] WARNING: Playwright patch failed: {e}", flush=True)

        try:
            outputs_dir = cls._THIS_DIR / "outputs"
            outputs_dir.mkdir(exist_ok=True)
            backups_dir = cls._THIS_DIR / "backups"
            backups_dir.mkdir(exist_ok=True)
            accounts_json = cls._THIS_DIR / "accounts.json"
            if not accounts_json.exists():
                accounts_json.write_text("[]", encoding="utf-8")
                print("[bootstrap] Created default empty accounts.json", flush=True)
        except Exception as e:
            print(f"[bootstrap] WARNING: Failed to setup directory/files: {e}", flush=True)
