"use client";

import { useState } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// AUDIT-022: Mask API keys in display — show first 4 + last 4 chars only
function maskKey(key) {
  if (typeof key !== "string" || key.length <= 12) return "••••••••";
  return `${key.slice(0, 4)}${"•".repeat(Math.min(key.length - 8, 12))}${key.slice(-4)}`;
}

function CopyBtn({ value }) {
  const { copied, copy } = useCopyToClipboard(1500);
  return (
    <button
      onClick={() => copy(value)}
      className="p-1 rounded text-text-muted hover:text-primary transition-colors cursor-pointer"
      title="Copy full key"
    >
      <span className="material-symbols-outlined text-[14px]">{copied ? "check" : "content_copy"}</span>
    </button>
  );
}

export default function ResultsPanel({ results }) {
  const { copied: allCopied, copy: copyAll } = useCopyToClipboard(2000);
  const [filter, setFilter] = useState("");

  const filtered = results.filter(
    (r) =>
      !filter ||
      r.provider?.toLowerCase().includes(filter.toLowerCase()) ||
      r.email?.toLowerCase().includes(filter.toLowerCase())
  );

  function exportTxt() {
    const lines = results.map((r) => `${r.provider}\t${r.email}\t${r.key}`).join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `harvest-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopyAll() {
    const text = results.map((r) => `${r.provider}:${r.email}:${r.key}`).join("\n");
    copyAll(text);
  }

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">key</span>
          <h2 className="text-sm font-semibold text-text-main">Harvested Keys</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
            {results.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="text-xs bg-surface-2 border border-border-subtle rounded-lg px-2.5 py-1.5 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40 w-32"
          />
          <button
            onClick={handleCopyAll}
            disabled={results.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[13px]">{allCopied ? "check" : "content_copy"}</span>
            {allCopied ? "Copied!" : "Copy All"}
          </button>
          <button
            onClick={exportTxt}
            disabled={results.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs hover:bg-surface-2 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[13px]">download</span>
            Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-80 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-8">
            {results.length === 0 ? "No keys harvested yet." : "No results match your filter."}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface border-b border-border-subtle">
              <tr>
                <th className="text-left px-4 py-2 text-text-muted font-semibold uppercase tracking-wider text-[10px]">Provider</th>
                <th className="text-left px-4 py-2 text-text-muted font-semibold uppercase tracking-wider text-[10px]">Email</th>
                <th className="text-left px-4 py-2 text-text-muted font-semibold uppercase tracking-wider text-[10px]">Key</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-2 text-primary font-medium">{r.provider}</td>
                  <td className="px-4 py-2 font-mono text-text-muted truncate max-w-[160px]">{r.email}</td>
                  {/* AUDIT-022: Show masked key in UI — use CopyBtn for full key */}
                  <td className="px-4 py-2 font-mono text-text-main truncate max-w-[200px] select-none" title="Click copy to get full key">
                    {maskKey(r.key)}
                  </td>
                  <td className="px-2 py-2">
                    <CopyBtn value={r.key} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


