"""Proxy manager — single / rotating / file / URL."""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse

from core.emit import Emit


class ProxyManager:
    def __init__(self, proxy_input: str = ""):
        self.proxy_input = proxy_input.strip()
        self.proxies: list[str] = []
        self._index = 0
        self._lock = asyncio.Lock()

    async def initialize(self) -> None:
        if not self.proxy_input:
            return

        try:
            if os.path.exists(self.proxy_input):
                with open(self.proxy_input, "r", encoding="utf-8", errors="ignore") as f:
                    self.proxies = [line.strip() for line in f if line.strip()]
                Emit.call({"type": "log", "message": f"[proxy] Loaded {len(self.proxies)} proxies from file."})
                return
        except Exception as e:
            Emit.call({"type": "warn", "message": f"[proxy] Error reading file: {e}"})

        if self.proxy_input.startswith(("http://", "https://", "socks5://", "socks4://")):
            parsed = urlparse(self.proxy_input)
            is_list_url = (
                parsed.path.endswith((".txt", ".csv"))
                or "list" in parsed.path
                or "proxies" in parsed.path
                # BUG-033 fix: removed `or not parsed.port` — URLs without explicit port
                # (e.g. http://myproxy.com/api) are NOT proxy list URLs
            )
            if is_list_url:
                try:
                    import aiohttp
                    async with aiohttp.ClientSession() as session:
                        async with session.get(self.proxy_input, timeout=15) as resp:
                            if resp.status == 200:
                                text = await resp.text()
                                lines = [l.strip() for l in text.splitlines() if l.strip()]
                                if lines:
                                    self.proxies = lines
                                    Emit.call({"type": "log", "message": f"[proxy] Loaded {len(self.proxies)} proxies from URL."})
                                    return
                except Exception as e:
                    Emit.call({"type": "warn", "message": f"[proxy] Failed to fetch proxy list: {e}"})

            if not self.proxies:
                self.proxies = [self.proxy_input]

        elif "," in self.proxy_input or "\n" in self.proxy_input:
            self.proxies = [
                p.strip()
                for p in self.proxy_input.replace("\r", "").replace(",", "\n").split("\n")
                if p.strip()
            ]
            Emit.call({"type": "log", "message": f"[proxy] Loaded {len(self.proxies)} proxies from text list."})
        elif self.proxy_input:
            self.proxies = [self.proxy_input]

        cleaned: list[str] = []
        for p in self.proxies:
            p = p.strip()
            if p:
                if not p.startswith(("http://", "https://", "socks5://", "socks4://")):
                    p = f"http://{p}"
                cleaned.append(p)
        self.proxies = cleaned

        if len(self.proxies) > 1:
            Emit.call({"type": "log", "message": f"[proxy] {len(self.proxies)} rotating proxies ready."})

    async def get_next_proxy(self) -> str:
        if not self.proxies:
            return ""
        async with self._lock:
            p = self.proxies[self._index]
            self._index = (self._index + 1) % len(self.proxies)
            return p
