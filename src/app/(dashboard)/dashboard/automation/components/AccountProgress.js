"use client";

import { cn } from "@/shared/utils/cn";

const STEP_STATUS = {
  pending:  { dot: "bg-surface-2 border border-border-subtle", text: "text-text-muted" },
  running:  { dot: "bg-amber-400 animate-pulse",               text: "text-amber-600 dark:text-amber-400" },
  success:  { dot: "bg-green-500",                             text: "text-green-600 dark:text-green-400" },
  error:    { dot: "bg-red-500",                               text: "text-red-500" },
  skipped:  { dot: "bg-surface-2 border border-border-subtle", text: "text-text-muted line-through" },
};

function StepBadge({ provider, status }) {
  const s = STEP_STATUS[status] ?? STEP_STATUS.pending;
  return (
    <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[10px] font-medium",
      status === "success" ? "border-green-500/30 bg-green-500/5" :
      status === "error"   ? "border-red-500/30 bg-red-500/5" :
      status === "running" ? "border-amber-400/40 bg-amber-400/5" :
      "border-border-subtle bg-surface-2"
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
      <span className={cn(s.text)}>{provider}</span>
    </div>
  );
}

const ACCOUNT_STATUS_STYLES = {
  pending:  { label: "Pending",  color: "text-text-muted",                    bg: "bg-surface-2",      border: "border-border-subtle" },
  running:  { label: "Running",  color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-400/5",    border: "border-amber-400/30" },
  done:     { label: "Done",     color: "text-green-600 dark:text-green-400", bg: "bg-green-500/5",    border: "border-green-500/20" },
  error:    { label: "Error",    color: "text-red-500",                        bg: "bg-red-500/5",      border: "border-red-500/20" },
  interact: { label: "Waiting",  color: "text-blue-500",                       bg: "bg-blue-500/5",     border: "border-blue-500/30" },
};

export default function AccountProgress({ accounts }) {
  if (!accounts || accounts.length === 0) return null;

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="material-symbols-outlined text-[18px] text-primary">manage_accounts</span>
        <h2 className="text-sm font-semibold text-text-main">Account Progress</h2>
        <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{accounts.length}</span>
      </div>
      <div className="divide-y divide-border-subtle max-h-[400px] overflow-y-auto custom-scrollbar">
        {accounts.map((acc) => {
          const st = ACCOUNT_STATUS_STYLES[acc.status] ?? ACCOUNT_STATUS_STYLES.pending;
          return (
            <div key={acc.email} className={cn("px-4 py-3 transition-colors", acc.status === "running" ? "bg-amber-400/3" : "")}>
              <div className="flex items-center gap-2 mb-2">
                <span className="material-symbols-outlined text-[14px] text-text-muted shrink-0">person</span>
                <span className="text-xs font-mono text-text-main flex-1 truncate">{acc.email}</span>
                <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border", st.color, st.bg, st.border)}>
                  {st.label}
                </span>
                {acc.slot != null && (
                  <span className="text-[10px] text-text-muted">slot {acc.slot}</span>
                )}
              </div>
              {acc.steps && acc.steps.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {acc.steps.map((step) => (
                    <StepBadge key={step.provider} provider={step.provider} status={step.status} />
                  ))}
                </div>
              )}
              {acc.currentMessage && (
                <p className="text-[10px] text-text-muted mt-1.5 truncate" title={acc.currentMessage}>
                  {acc.currentMessage}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
