"use client";

import { cn } from "@/shared/utils/cn";

const STATUS_CONFIG = {
  connected:    { dot: "bg-green-500",  text: "text-green-600 dark:text-green-400",  label: "Connected" },
  connecting:   { dot: "bg-amber-400 animate-pulse", text: "text-amber-600 dark:text-amber-400", label: "Connecting..." },
  disconnected: { dot: "bg-red-500",    text: "text-red-600 dark:text-red-400",      label: "Disconnected" },
};

export default function ConnectionBar({ status, serverUrl, onServerUrlChange, enabled, onToggle }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected;
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] flex-wrap">
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
        <span className={cn("text-xs font-semibold", cfg.text)}>{cfg.label}</span>
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-[180px]">
        <span className="text-xs text-text-muted shrink-0">Server:</span>
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => onServerUrlChange(e.target.value)}
          disabled={enabled}
          className="flex-1 text-xs font-mono bg-surface-2 border border-border-subtle rounded-md px-2 py-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-50"
          placeholder="http://localhost:8765"
        />
      </div>
      <span className="text-[11px] text-text-muted shrink-0 hidden sm:block">
        ws:{serverUrl.replace(/^https?/, "")}/ws
      </span>
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0",
          enabled
            ? "bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/20"
            : "bg-primary text-white hover:bg-primary/90 shadow-[var(--shadow-warm)]"
        )}
      >
        <span className="material-symbols-outlined text-[14px]">
          {isConnecting ? "sync" : enabled ? "wifi_off" : "wifi"}
        </span>
        {isConnecting ? "Connecting..." : enabled ? "Disconnect" : "Connect"}
      </button>
    </div>
  );
}
