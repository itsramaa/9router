"""
Simulation mode — runs the REAL harvest pipeline (run_harvest, HarvestWorker,
CheckpointManager, OutputWriter, Emit, interact_gate) but replaces only two things:

1. BrowserManager.launch  → returns a fake manager + browser + page (no Camoufox)
2. harvest.<provider>.harvest → returns a fake API key after a short delay

Everything else — slot queue, semaphore, checkpoint save, output file, lock file,
stdin interact reader, progress/error/result events — is 100% real code.
"""

from __future__ import annotations

import asyncio
import importlib
import random
import string
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from .checkpoint import CheckpointManager
from .config import Config
from .emit import Emit
from .output import OutputWriter

# ── Fake key generator ────────────────────────────────────────────────────────


def _fake_key(provider: str) -> str:
    rand = lambda n: "".join(random.choices(string.ascii_letters + string.digits, k=n))
    templates = {
        "kiro": f"kiro-rt-{rand(32)}",
        "openrouter": f"sk-or-v1-{rand(64)}",
        "siliconflow": f"sk-{rand(48)}",
        "xai": f"xai-{rand(56)}",
        "qoder": f"qdr_{rand(40)}",
        "kilocode": f"kc_{rand(36)}",
        "deno": f"ddp_{rand(44)}",
    }
    return templates.get(provider, f"{provider[:4]}-sim-{rand(32)}")


# ── Fake page / browser / manager objects ────────────────────────────────────
# HarvestWorker calls: page.evaluate(), browser.new_page(), manager.__aexit__(),
# page.context.pages, streamer.start/stop, etc.
# We provide enough surface area that the worker doesn't crash.


def _make_fake_page() -> MagicMock:
    page = MagicMock()
    # async methods
    page.evaluate = AsyncMock(return_value=None)
    page.goto = AsyncMock(return_value=None)
    page.wait_for_selector = AsyncMock(return_value=MagicMock())
    page.click = AsyncMock(return_value=None)
    page.fill = AsyncMock(return_value=None)
    page.screenshot = AsyncMock(return_value=b"")
    page.reload = AsyncMock(return_value=None)
    page.go_back = AsyncMock(return_value=None)
    page.set_viewport_size = AsyncMock(return_value=None)
    page.keyboard = MagicMock()
    page.keyboard.type = AsyncMock(return_value=None)
    page.mouse = MagicMock()
    page.mouse.click = AsyncMock(return_value=None)
    page.mouse.wheel = AsyncMock(return_value=None)
    # sync props
    page.url = "about:blank"
    page.is_closed = MagicMock(return_value=False)
    page.set_default_timeout = MagicMock()
    page.on = MagicMock()
    # context
    ctx = MagicMock()
    ctx.pages = [page]
    ctx.grant_permissions = AsyncMock(return_value=None)
    ctx.add_init_script = AsyncMock(return_value=None)
    page.context = ctx
    return page


def _make_fake_browser(page: MagicMock) -> MagicMock:
    browser = MagicMock()
    browser.new_page = AsyncMock(return_value=page)
    return browser


def _make_fake_manager() -> MagicMock:
    mgr = MagicMock()
    mgr.__aenter__ = AsyncMock(return_value=_make_fake_browser(_make_fake_page()))
    mgr.__aexit__ = AsyncMock(return_value=None)
    return mgr


async def _fake_browser_launch(
    slot: int = 0, email: str = "", proxy_url: str = ""
) -> tuple[Any, Any, Any]:
    """Drop-in replacement for BrowserManager.launch — no Camoufox, instant."""
    page = _make_fake_page()
    browser = _make_fake_browser(page)
    manager = MagicMock()
    manager.__aexit__ = AsyncMock(return_value=None)
    return manager, browser, page


# ── Fake FrameStreamer ────────────────────────────────────────────────────────
# The real FrameStreamer calls page.screenshot() in a loop. We replace it with
# a no-op so the event loop isn't full of screenshot tasks.


class _FakeFrameStreamer:
    def __init__(self, page: Any, slot: int):
        self.slot = slot
        self.page = page

    def start(self):
        return asyncio.create_task(asyncio.sleep(0))

    async def stop(self):
        pass

    async def capture_once(self):
        pass

    def set_page(self, page):
        self.page = page


# ── Per-provider fake harvest function factory ────────────────────────────────


def _make_fake_harvest_fn(
    provider: str, fail_rate: float, interact_rate: float, delay: float
):
    """Returns an async function with the same signature as real harvest fns."""

    async def _fake_harvest(page, email, password, **kwargs):
        await asyncio.sleep(delay * random.uniform(0.5, 1.2))

        # Simulate interact_required
        if random.random() < interact_rate:
            from .interact import interact_gate
            from .context import _slot

            slot = _slot.get() or 0
            # interact_gate returns "" in non-interactive mode (Config.INTERACTIVE_MODE=False)
            # In interactive mode it waits for user — behaviour is real.
            result = await interact_gate(
                slot, page, f"[sim] {provider}: captcha detected", email
            )
            if result in ("", None):
                # Auto-continue after short delay
                await asyncio.sleep(delay * 0.5)

        await asyncio.sleep(delay * random.uniform(0.3, 0.7))

        # Simulate failure
        if random.random() < fail_rate:
            raise RuntimeError(f"[sim] {provider}: login failed (simulated)")

        return _fake_key(provider)

    return _fake_harvest


# ── Main entry point (called by run.py --simulate) ───────────────────────────


async def run_simulated_harvest(
    accounts: list[dict],
    providers: list[str],
    concurrent: int,
    output_dir: Path,
    fail_rate: float = 0.1,
    interact_rate: float = 0.1,
    delay: float = 0.5,
    resume: bool = False,
) -> None:
    """
    Run the real run_harvest() pipeline with mocked browser + harvest fns.
    All real code paths execute: checkpoint, emit, output, slot queue, semaphore.
    """
    from .worker import HarvestWorker
    from . import frames as _frames_mod
    from . import browser as _browser_mod

    # Build patches for every provider's harvest function
    harvest_patches: list[Any] = []
    for pname in providers:
        reg = Config.PROVIDER_REGISTRY.get(pname)
        if not reg:
            continue
        module_path = reg["module"]
        fn_name = reg["fn"]
        fake_fn = _make_fake_harvest_fn(pname, fail_rate, interact_rate, delay)
        # We patch at the module level so importlib.import_module + getattr picks it up
        try:
            mod = importlib.import_module(module_path)
            harvest_patches.append(patch.object(mod, fn_name, new=fake_fn))
        except Exception as e:
            Emit.call(
                {
                    "type": "warn",
                    "message": f"[sim] Could not patch {module_path}.{fn_name}: {e}",
                }
            )

    # Patch BrowserManager.launch and FrameStreamer
    browser_patch = patch.object(
        _browser_mod.BrowserManager, "launch", new=staticmethod(_fake_browser_launch)
    )
    streamer_patch = patch.object(_frames_mod, "FrameStreamer", new=_FakeFrameStreamer)
    # cleanup_camoufox_temp is a no-op in sim — already safe, but patch to avoid
    # any file-system side-effects
    cleanup_patch = patch.object(
        _browser_mod, "cleanup_camoufox_temp", new=lambda: None
    )

    all_patches = [browser_patch, streamer_patch, cleanup_patch] + harvest_patches

    Emit.call(
        {
            "type": "log",
            "message": f"[sim] Patches active for {len(harvest_patches)} providers",
        }
    )

    # Apply all patches
    started = []
    try:
        for p in all_patches:
            p.start()
            started.append(p)

        # Checkpoint — honour resume
        from run import run_harvest  # re-use the real run_harvest from run.py

        cp_mgr = CheckpointManager(output_dir)

        if resume:
            cp = cp_mgr.load()
            completed = set(cp.get("completed", {}).keys())
            if completed:
                before = len(accounts)
                accounts = [a for a in accounts if a["email"] not in completed]
                Emit.call(
                    {
                        "type": "log",
                        "message": f"[sim] Resume: {before - len(accounts)} already done, "
                        f"{len(accounts)} remaining",
                    }
                )
        else:
            cp_mgr.remove()

        # ProxyManager stub (no real proxy needed in sim)
        from .proxy import ProxyManager

        proxy_mgr = ProxyManager("")
        await proxy_mgr.initialize()

        from datetime import datetime

        all_results = await run_harvest(
            accounts, providers, concurrent, proxy_mgr, 60.0, cp_mgr
        )

        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = output_dir / f"harvest-sim-{ts}.txt"
        OutputWriter.save(all_results, output_path)

        total_keys = sum(len(r.get("api_keys", {})) for r in all_results)
        Emit.call(
            {
                "type": "done",
                "total_accounts": len(accounts),
                "total_keys": total_keys,
                "output": str(output_path),
                "message": f"[sim] Done. {total_keys} keys → {output_path}",
            }
        )

    finally:
        for p in reversed(started):
            try:
                p.stop()
            except Exception:
                pass
