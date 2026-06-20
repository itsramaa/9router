"use client";

import { cn } from "@/shared/utils/cn";

const STATUS_STYLES = {
  idle:     { border: "border-border-subtle",  bg: "",                 dot: "bg-border-subtle",           label: "Idle" },
  running:  { border: "border-amber-400/40",   bg: "bg-amber-400/5",   dot: "bg-amber-400 animate-pulse", label: "Running" },
  interact: { border: "border-blue-500/40",    bg: "bg-blue-500/5",    dot: "bg-blue-500 animate-pulse",  label: "Waiting" },
  done:     { border: "border-green-500/30",   bg: "bg-green-500/5",   dot: "bg-green-500",               label: "Done" },
  error:    { border: "border-red-500/30",     bg: "bg-red-500/5",     dot: "bg-red-500",                 label: "Error" },
};

export default function SlotDetail({ slot, frame, onInteract }) {
  const st = STATUS_STYLES[slot.status] ?? STATUS_STYLES.idle;
  const hasFrame = Boolean(frame);

  return (
    <div className={cn("rounded-xl border overflow-hidden transition-colors", st.border, st.bg)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/50">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", st.dot)} />
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Slot {slot.index}</span>
        <span className={cn("text-[10px] font-semibold ml-auto", st.dot === "bg-green-500" ? "text-green-600 dark:text-green-400" : "text-text-muted")}>
          {st.label}
        </span>
      </div>

      {/* Screenshot */}
      <div className="relative bg-black/20 aspect-video overflow-hidden">
        {hasFrame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt={`Slot ${slot.index} screenshot`}
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="material-symbols-outlined text-[24px] text-text-muted/40">monitor</span>
            <span className="text-[10px] text-text-muted/40">No screenshot</span>
          </div>
        )}
        {slot.status === "interact" && (
          <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center">
            <div className="bg-surface/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-blue-500/30">
              <span className="material-symbols-outlined text-[16px] text-blue-500 animate-pulse">touch_app</span>
              <span className="text-xs font-semibold text-blue-500">Interaction Required</span>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="px-3 py-2 space-y-0.5">
        <p className="text-[11px] font-mono text-text-main truncate" title={slot.email}>{slot.email || "—"}</p>
        {slot.provider && (
          <p className="text-[10px] text-primary/80 truncate">
            <span className="material-symbols-outlined text-[10px] align-middle mr-0.5">arrow_right</span>
            {slot.provider}
          </p>
        )}
        {slot.message && (
          <p className="text-[10px] text-text-muted truncate" title={slot.message}>{slot.message}</p>
        )}
      </div>

      {/* Interact button if waiting */}
      {slot.status === "interact" && onInteract && (
        <div className="px-3 pb-2">
          <button
            onClick={() => onInteract(slot.index)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            Open Solver
          </button>
        </div>
      )}
    </div>
  );
}
