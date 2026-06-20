"use client";

import { useState } from "react";
import { cn } from "@/shared/utils/cn";

export default function AccountsPanel({ accounts, onChange, serverUrl }) {
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addAccount() {
    const email = newEmail.trim();
    const password = newPassword.trim();
    if (!email || !password) return;
    if (accounts.some((a) => a.email === email)) {
      setError("Email already exists.");
      return;
    }
    setError("");
    onChange([...accounts, { email, password }]);
    setNewEmail("");
    setNewPassword("");
  }

  function removeAccount(email) {
    onChange(accounts.filter((a) => a.email !== email));
  }

  async function saveToServer() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/automation/api/save_accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">manage_accounts</span>
          <h2 className="text-sm font-semibold text-text-main">Accounts</h2>
          <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
            {accounts.length}
          </span>
        </div>
        <button
          onClick={saveToServer}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <span className="material-symbols-outlined text-[14px]">{saving ? "sync" : "cloud_upload"}</span>
          {saving ? "Saving..." : "Save to Server"}
        </button>
      </div>

      {/* Add row */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-surface-2/50">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAccount()}
          placeholder="email@gmail.com"
          className="flex-1 text-xs bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addAccount()}
          placeholder="password"
          className="flex-1 text-xs bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          onClick={addAccount}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add
        </button>
      </div>

      {error && (
        <p className="px-4 py-2 text-xs text-red-500">{error}</p>
      )}

      {/* Account list */}
      <div className="divide-y divide-border-subtle max-h-64 overflow-y-auto custom-scrollbar">
        {accounts.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-muted text-center">No accounts yet. Add one above.</p>
        ) : (
          accounts.map((acc, i) => (
            <div key={acc.email} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-surface-2 transition-colors">
              <span className="material-symbols-outlined text-[16px] text-text-muted shrink-0">person</span>
              <span className="flex-1 text-xs text-text-main font-mono truncate">{acc.email}</span>
              <span className="text-xs text-text-muted">••••••</span>
              <button
                onClick={() => removeAccount(acc.email)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-500 cursor-pointer"
                aria-label="Remove account"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
