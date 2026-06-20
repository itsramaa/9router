"""Proxy manager — single / rotating / file / URL."""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlparse


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
                print(f"[ProxyManager] Loaded {len(self.proxies)} proxies from local file: {self.proxy_input}")
                return
        except Exception as e:
            print(f"[ProxyManager] Error reading local file {self.proxy_input}: {e}")

        if self.proxy_input.startswith(("http://", "https://", "socks5://", "socks4://")):
            parsed = urlparse(self.proxy_input)
            is_list_url = False
            if parsed.path.endswith((".txt", ".csv")) or "list" in parsed.path or "proxies" in parsed.path or not parsed.port:
                is_list_url = True

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
                                    print(f"[ProxyManager] Loaded {len(self.proxies)} proxies from remote URL: {self.proxy_input}")
                                    return
                except Exception as e:
                    print(f"[ProxyManager] Failed to fetch proxy list from URL {self.proxy_input}: {e}")

            if not self.proxies:
                self.proxies = [self.proxy_input]

        elif "," in self.proxy_input or "\n" in self.proxy_input:
            self.proxies = [p.strip() for p in self.proxy_input.replace("\r", "").replace(",", "\n").split("\n") if p.strip()]
            print(f"[ProxyManager] Loaded {len(self.proxies)} proxies from raw text list.")

        elif self.proxy_input:
            self.proxies = [self.proxy_input]

        cleaned: list[str] = []
        for p in self.proxies:
            p_clean = p.strip()
            if p_clean:
                if not p_clean.startswith(("http://", "https://", "socks5://", "socks4://")):
                    p_clean = f"http://{p_clean}"
                cleaned.append(p_clean)
        self.proxies = cleaned
        if self.proxies and len(self.proxies) > 1:
            print(f"[ProxyManager] Initialized with {len(self.proxies)} rotating proxies.")

    async def get_next_proxy(self) -> str:
        if not self.proxies:
            return ""
        async with self._lock:
            p = self.proxies[self._index]
            self._index = (self._index + 1) % len(self.proxies)
            return p
