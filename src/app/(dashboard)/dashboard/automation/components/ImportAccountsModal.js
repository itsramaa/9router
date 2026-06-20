"use client";

import { useState, useRef } from "react";
import { cn } from "@/shared/utils/cn";

/**
 * Parses account text in two formats (mirrors Python accounts.py logic):
 *   Format 1: email:pass  (one per line)
 *   Format 2: Password: xxx\n email1\n email2  (shared password block)
 *
 * Returns array of { email, password }
 */
function parseAccountText(text) {
  const accounts = [];
  let globalPassword = null;
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  for (const line of lines) {
    if (line.toLowerCase().startsWith("password:")) {
      globalPassword = line.split(":").slice(1).join(":").trim();
      continue;
    }

    let email, password;

    if (line.includes(":")) {
      const idx = line.indexOf(":");
      email    = line.slice(0, idx).trim();
      password = line.slice(idx + 1).trim();
    } else if (line.includes(" ")) {
      const parts = line.split(/\s+/);
      email    = parts[0];
      password = parts[1];
    } else {
      email = line;
    }

    if (!email || !email.includes("@")) continue;

    if (!password && globalPassword) {
      password = globalPassword;
    }

    if (email && password) {
      accounts.push({ email: email.toLowerCase(), password });
    }
  }
  return accounts;
}

export default function ImportAccountsModal({ onImport, onClose }) {
  const [tab, setTab]           = useState("paste");
  const [text, setText]         = useState("");
  const [preview, setPreview]   = useState([]);
  const [error, setError]       = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef                 = useRef(null);

  function handleTextChange(val) {
    setText(val);
    setError("");
    try {
      const parsed = parseAccountText(val);
      setPreview(parsed);
    } catch { setPreview([]); }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target.result;
      setText(content);
      handleTextChange(content);
    };
    reader.readAsText(file, "utf-8");
  }

  async function handleImport() {
    if (preview.length === 0) { setError("No valid accounts parsed."); return; }
    setImporting(true);
    try {
      await onImport(preview);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-2xl border border-border-subtle bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border-subtle">
          <span className="material-symbols-outlined text-[20px] text-primary">upload_file</span>
          <h2 className="text-sm font-semibold text-text-main flex-1">Import Accounts</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main cursor-pointer">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Format hint */}
        <div className="px-5 py-3 bg-surface-2/50 border-b border-border-subtle">
          <p className="text-[11px] text-text-muted mb-1.5 font-semibold uppercase tracking-wider">Supported formats</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface border border-border-subtle px-3 py-2">
              <p className="text-[10px] font-semibold text-primary mb-1">Format 1 — email:pass</p>
              <pre className="text-[10px] text-text-muted font-mono">user@gmail.com:pass123
user2@gmail.com:pass456</pre>
            </div>
            <div className="rounded-lg bg-surface border border-border-subtle px-3 py-2">
              <p className="text-[10px] font-semibold text-primary mb-1">Format 2 — shared password</p>
              <pre className="text-[10px] text-text-muted font-mono">Password: sharedpass
user1@gmail.com
user2@gmail.com</pre>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-subtle px-5 gap-4 bg-surface-2/30">
          {[{ id: "paste", label: "Paste Text", icon: "content_paste" }, { id: "file", label: "Upload File", icon: "upload_file" }].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 py-2.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer",
                tab === t.id ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
          {tab === "paste" ? (
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={"user@gmail.com:password123\nuser2@gmail.com:password456\n\n# Or with shared password:\nPassword: sharedpass\nuser3@gmail.com\nuser4@gmail.com"}
              rows={10}
              className="w-full text-xs font-mono bg-surface-2 border border-border-subtle rounded-lg px-3 py-2.5 text-text-main placeholder:text-text-muted/50 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
            />
          ) : (
            <div
              className="border-2 border-dashed border-border-subtle rounded-xl py-12 flex flex-col items-center gap-3 cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <span className="material-symbols-outlined text-[32px] text-text-muted/50">upload_file</span>
              <p className="text-sm text-text-muted">Click to select .txt file</p>
              <p className="text-[11px] text-text-muted/60">accounts.txt, accounts-list.txt, etc.</p>
              <input ref={fileRef} type="file" accept=".txt,.csv" className="hidden" onChange={handleFile} />
            </div>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div className="rounded-lg border border-border-subtle overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-surface-2/50 border-b border-border-subtle">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Preview</span>
                <span className="text-[11px] text-primary font-semibold">{preview.length} account{preview.length !== 1 ? "s" : ""} parsed</span>
              </div>
              <div className="max-h-40 overflow-y-auto custom-scrollbar divide-y divide-border-subtle">
                {preview.slice(0, 50).map((acc, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="material-symbols-outlined text-[13px] text-text-muted shrink-0">person</span>
                    <span className="text-xs font-mono text-text-main flex-1 truncate">{acc.email}</span>
                    <span className="text-[10px] text-text-muted">••••••</span>
                  </div>
                ))}
                {preview.length > 50 && (
                  <p className="px-3 py-2 text-[11px] text-text-muted">...and {preview.length - 50} more</p>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border-subtle bg-surface-2/50">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-semibold hover:bg-surface-2 transition-colors cursor-pointer">
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={handleImport}
            disabled={importing || preview.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[14px]">{importing ? "sync" : "save"}</span>
            {importing ? "Importing..." : `Import ${preview.length} account${preview.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
