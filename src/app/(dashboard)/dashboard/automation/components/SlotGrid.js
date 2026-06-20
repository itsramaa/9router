"use client";

import { cn } from "@/shared/utils/cn";

const SLOT_STATUS_STYLES = {
  idle:      { bg: "bg-surface-2",           border: "border-border-subtle",  dot: "bg-surface-2 border border-border-subtle", label: "Idle" },
  running:   { bg: "bg-green-500/5",          border: "border-green-500/30",   dot: "bg-green-500 animate-pulse",               label: "Running" },
  done:      { bg: "bg-blue-500/5",           border: "border-blue-500/20",    dot: "bg-blue-500",                              label: "Done" },
  error:     { bg: "bg-red-500/5",            border: "border-red-500/20",     dot: "bg-red-500",                               label: "Error" },
};

function SlotCard({ slot }) {
  const st = SLOT_STATUS_STYLES[slot.status] ?? SLOT_STATUS_STYLES.idle;
  return (
    <div className={cn("rounded-xl border p-3 transition-colors", st.bg, st.border)}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Slot {slot.index}</span>
        <div className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full", st.dot)} />
          <span className="text-[10px] text-text-muted">{st.label}</span>
        </div>
      </div>
      <p className="text-xs font-mono text-text-main truncate" title={slot.email}>
        {slot.email || "—"}
      </p>
      {slot.provider && (
        <p className="text-[11px] text-primary/80 mt-0.5 truncate">
          <span className="material-symbols-outlined text-[11px] align-middle mr-0.5">arrow_right</span>
          {slot.provider}
        </p>
      )}
      {slot.message && (
        <p className="text-[10px] text-text-muted mt-1 truncate" title={slot.message}>{slot.message}</p>
      )}
    </div>
  );
}

export default function SlotGrid({ slots }) {
  if (!slots || slots.length === 0) {
    return (
      <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[18px] text-primary">view_module</span>
          <h2 className="text-sm font-semibold text-text-main">Browser Slots</h2>
        </div>
        <p className="text-xs text-text-muted text-center py-4">No active slots. Start a harvest to see live browser states.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="material-symbols-outlined text-[18px] text-primary">view_module</span>
        <h2 className="text-sm font-semibold text-text-main">Browser Slots</h2>
        <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{slots.length}</span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {slots.map((slot) => (
          <SlotCard key={slot.index} slot={slot} />
        ))}
      </div>
    </div>
  );
}
