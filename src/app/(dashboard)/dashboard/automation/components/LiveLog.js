"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";

const TYPE_STYLES = {
  progress: "text-text-main",
  log:      "text-text-muted",
  error:    "text-red-500 dark:text-red-400",
  api_key:  "text-green-600 dark:text-green-400 font-semibold",
  result:   "text-blue-600 dark:text-blue-400 font-semibold",
};

const TYPE_ICONS = {
  progress: "arrow_right",
  log:      "info",
  error:    "error",
  api_key:  "key",
  result:   "check_circle",
};

export default function LiveLog({ entries, onClear }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">terminal</span>
          <h2 className="text-sm font-semibold text-text-main">Live Log</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-surface-2 text-text-muted text-[11px] font-mono">
            {entries.length}
          </span>
        </div>
        <button
          onClick={onClear}
          className="text-xs text-text-muted hover:text-text-main transition-colors cursor-pointer flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar min-h-[200px] max-h-[340px] px-3 py-2 font-mono text-[11px] space-y-0.5 bg-surface-2/30">
        {entries.length === 0 ? (
          <p className="text-text-muted text-center py-8">No log entries yet. Start a harvest to see output.</p>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={cn("flex items-start gap-1.5 leading-relaxed", TYPE_STYLES[e.type] ?? TYPE_STYLES.log)}>
              <span className="material-symbols-outlined text-[12px] mt-px shrink-0 opacity-70">
                {TYPE_ICONS[e.type] ?? "circle"}
              </span>
              <span className="opacity-50 shrink-0">{e.ts}</span>
              {e.slot != null && (
                <span className="px-1 rounded bg-surface-2 text-text-muted shrink-0">[{e.slot}]</span>
              )}
              {e.provider && (
                <span className="text-primary/80 shrink-0">[{e.provider}]</span>
              )}
              <span className="break-all">{e.message ?? e.error}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
