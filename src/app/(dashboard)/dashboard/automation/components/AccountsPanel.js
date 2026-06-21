'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import ImportAccountsModal from './ImportAccountsModal';

export default function AccountsPanel({ onChange }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [backupInfo, setBackupInfo] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [clearing, setClearing] = useState(false);

  // Store onChange in a ref so load() can call it without it being a dep
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/accounts');
      const data = await res.json();
      if (Array.isArray(data.accounts)) {
        setAccounts(data.accounts);
        onChangeRef.current?.(data.accounts);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []); // stable — uses ref, no external deps

  useEffect(() => {
    load();
  }, [load]);

  async function addAccount() {
    const email = newEmail.trim();
    const password = newPassword.trim();
    if (!email || !password) {
      setError('Email and password required.');
      return;
    }
    if (!email.includes('@')) {
      setError('Invalid email.');
      return;
    }
    setError('');
    try {
      const res = await fetch('/api/automation/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed');
        return;
      }
      setNewEmail('');
      setNewPassword('');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeAccount(id) {
    setDeleting(id);
    try {
      await fetch('/api/automation/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  async function handleImport(parsed) {
    const res = await fetch('/api/automation/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: parsed }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    await load();
    return data;
  }

  async function clearAll() {
    if (!confirm(`Delete all ${accounts.length} accounts?`)) return;
    setClearing(true);
    try {
      const res = await fetch('/api/automation/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (data.backupPath) {
        setBackupInfo({ deleted: data.deleted, backupPath: data.backupPath });
      }
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">
              manage_accounts
            </span>
            <h2 className="text-sm font-semibold text-text-main">Accounts</h2>
            <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
              {accounts.length}
            </span>
            <span className="text-[10px] text-text-muted">stored in DB</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-medium hover:bg-surface-2 hover:text-text-main transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">
                upload_file
              </span>
              Import
            </button>
            {accounts.length > 0 && (
              <button
                onClick={clearAll}
                disabled={clearing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-xs font-medium hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {clearing ? 'sync' : 'delete_sweep'}
                </span>
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Add row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-surface-2/50">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && addAccount()}
            placeholder="email@gmail.com"
            className="flex-1 text-xs bg-surface border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && addAccount()}
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

        {error && <p className="px-4 py-2 text-xs text-red-500">{error}</p>}

        {backupInfo && (
          <div className="px-4 py-2 text-xs bg-green-500/10 text-green-500 rounded-lg mx-4">
            <span className="material-symbols-outlined text-[14px] align-middle mr-1">
              backup
            </span>
            {backupInfo.deleted} accounts backed up to: {backupInfo.backupPath}
          </div>
        )}

        {/* List */}
        <div className="divide-y divide-border-subtle overflow-y-auto custom-scrollbar">
          {loading ? (
            <p className="px-4 py-6 text-xs text-text-muted text-center">
              Loading...
            </p>
          ) : accounts.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-text-muted">No accounts yet.</p>
              <button
                onClick={() => setShowImport(true)}
                className="mt-2 text-xs text-primary hover:underline cursor-pointer"
              >
                Import from file
              </button>
            </div>
          ) : (
            accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center gap-3 px-4 py-2.5 group hover:bg-surface-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px] text-text-muted shrink-0">
                  person
                </span>
                <span className="flex-1 text-xs text-text-main font-mono truncate">
                  {acc.email}
                </span>
                <span className="text-xs text-text-muted">••••••</span>
                <button
                  onClick={() => removeAccount(acc.id)}
                  disabled={deleting === acc.id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-red-500 cursor-pointer disabled:opacity-50"
                  aria-label="Remove"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {deleting === acc.id ? 'sync' : 'delete'}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {showImport && (
        <ImportAccountsModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </>
  );
}
