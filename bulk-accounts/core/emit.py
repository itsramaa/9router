"""Stdout JSON-lines emit (sync & async)."""

from __future__ import annotations


import asyncio

import json

import logging

import sys

from typing import Any

from .context import _slot, _email


class Emit:

    _lock: asyncio.Lock | None = None

    _callback: Any = None

    @classmethod
    def _ensure_lock(cls) -> asyncio.Lock:
        """Ensure lock exists — safe for single-threaded asyncio event loop."""
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    @classmethod
    def set_callback(cls, cb: Any) -> None:

        cls._callback = cb

    @classmethod
    async def async_call(cls, data: dict) -> None:

        try:

            if cls._callback:

                cls._callback(data)

                return

            line = json.dumps(data, ensure_ascii=False) + "\n"

            async with cls._ensure_lock():

                sys.stdout.write(line)

                sys.stdout.flush()

        except Exception as _e:

            logging.warning(f"Swallowed exception in async_call: {_e}")

    @staticmethod
    def call(data: dict) -> None:

        # NOTE: BUG-029 — This method is NOT thread-safe. It is safe only when called

        # from asyncio coroutines (single-threaded event loop). Do NOT call from

        # thread pool executors (loop.run_in_executor) as stdout writes may interleave.

        try:

            # Inject context if missing

            if data.get("slot") is None:

                slot = _slot.get()

                if slot:
                    data["slot"] = slot

            if data.get("email") is None:

                email = _email.get()

                if email:
                    data["email"] = email

            if Emit._callback:

                Emit._callback(data)

                return

            line = json.dumps(data, ensure_ascii=False) + "\n"

            sys.stdout.write(line)

            sys.stdout.flush()

        except BrokenPipeError:

            pass

        except Exception as _e:

            logging.warning(f"Error in Emit.call: {_e}")

    @classmethod
    def emit(cls, data: dict) -> None:
        """Central entry point for all emissions."""

        cls.call(data)

    @classmethod
    def log(cls, message: str, slot: int | None = None, email: str | None = None):

        cls.call({"type": "log", "slot": slot, "email": email, "message": message})

    # ── High-level Helpers ───────────────────────────────────────────────────

    @classmethod
    def progress(
        cls,
        provider: str,
        step: str,
        message: str,
        slot: int | None = None,
        email: str | None = None,
    ):

        cls.call(
            {
                "type": "progress",
                "provider": provider,
                "step": step,
                "message": message,
                "slot": slot,
                "email": email,
            }
        )

    @classmethod
    def error(
        cls,
        provider: str,
        error: Any,
        slot: int | None = None,
        email: str | None = None,
    ):

        cls.call(
            {
                "type": "error",
                "provider": provider,
                "error": str(error),
                "slot": slot,
                "email": email,
            }
        )

    @classmethod
    def api_key(
        cls,
        provider: str,
        key: str,
        message: str = "",
        slot: int | None = None,
        email: str | None = None,
    ):

        cls.call(
            {
                "type": "api_key",
                "slot": slot,
                "email": email,
                "provider": provider,
                "key_preview": key[:16] + "...",
                "message": message or f"  ✓ {provider}: {key[:16]}...",
            }
        )

    @classmethod
    def result(
        cls,
        api_keys: dict,
        message: str = "",
        slot: int | None = None,
        email: str | None = None,
    ):

        target_email = email or _email.get() or "unknown"

        n_ok = len(api_keys)

        cls.call(
            {
                "type": "result",
                "slot": slot,
                "email": target_email,
                "api_keys": api_keys,
                "message": message or f"Done {target_email}: {n_ok} keys",
            }
        )
