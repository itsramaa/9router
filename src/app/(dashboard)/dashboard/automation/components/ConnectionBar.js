"use client";

import { cn } from "@/shared/utils/cn";

const STATUS_CONFIG = {
  connected:    { dot: "bg-green-500",  text: "text-green-600 dark:text-green-400",  label: "Connected" },
  connecting:   { dot: "bg-amber-400 animate-pulse", text: "text-amber-600 dark:text-amber-400", label: "Connecting..." },
  disconnected: { dot: "bg-red-500",    text: "text-red-600 dark:text-red-400",      label: "Disconnected" },
};

export default function ConnectionBar({ status, serverUrl, onServerUrlChange }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.disconnected;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] flex-wrap">
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("w-2 h-2 rounded-full", cfg.dot)} />
        <span className={cn("text-xs font-semibold", cfg.text)}>{cfg.label}</span>
      </div>
      <div className="flex items-center gap-2 flex-1 min-w-[220px]">
        <span className="text-xs text-text-muted shrink-0">Server:</span>
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => onServerUrlChange(e.target.value)}
          className="flex-1 text-xs font-mono bg-surface-2 border border-border-subtle rounded-md px-2 py-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary/40"
          placeholder="http://localhost:8765"
        />
      </div>
      <span className="text-[11px] text-text-muted shrink-0">
        WS: {serverUrl.replace(/^http/, "ws")}/ws
      </span>
    </div>
  );
}
