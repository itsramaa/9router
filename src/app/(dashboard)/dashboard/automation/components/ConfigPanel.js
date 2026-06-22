'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/shared/utils/cn';

const ALL_PROVIDERS = [
  { id: 'kiro', label: 'Kiro' },

  { id: 'xai', label: 'xAI' },

  { id: 'qoder', label: 'Qoder' },

  { id: 'siliconflow', label: 'SiliconFlow' },

  { id: 'kilocode', label: 'Kilo Code' },

  { id: 'openrouter', label: 'OpenRouter' },

  { id: 'deno', label: 'Deno Deploy' },
];

const DISPLAY_MODES = [
  {
    id: 'headless',
    label: 'Headless',
    icon: 'visibility_off',
    desc: 'No browser window (default, fastest)',
  },

  {
    id: 'headed',
    label: 'Headed',
    icon: 'visibility',
    desc: 'Visible browser window (local only)',
  },

  {
    id: 'virtual',
    label: 'Virtual (Xvfb) - Linux Only',
    icon: 'desktop_windows',
    desc: 'Virtual display — Recommended For Linux',
  },
];

export default function ConfigPanel({ config, onChange }) {
  const { providers, concurrent, proxy, displayMode = 'headless', apiKey = '' } = config;
  const [showApiKey, setShowApiKey] = useState(false);
  const [availableKeys, setAvailableKeys] = useState([]);
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    fetch('/api/keys')
      .then((r) => r.ok ? r.json() : { keys: [] })
      .then((data) => setAvailableKeys(Array.isArray(data.keys) ? data.keys : []))
      .catch(() => { });
  }, []);

  useEffect(() => {
    if (!showKeyDropdown) return;
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowKeyDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showKeyDropdown]);

  function toggleProvider(id) {
    onChange({
      ...config,

      providers: providers.includes(id)
        ? providers.filter((p) => p !== id)
        : [...providers, id],
    });
  }

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="material-symbols-outlined text-[18px] text-primary">
          tune
        </span>

        <h2 className="text-sm font-semibold text-text-main">Configuration</h2>
      </div>

      <div className="p-4 space-y-5">
        {/* Providers */}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Providers
            </span>

            <div className="flex gap-2">
              <button
                onClick={() =>
                  onChange({
                    ...config,
                    providers: ALL_PROVIDERS.map((p) => p.id),
                  })
                }
                className="text-[11px] text-primary hover:underline cursor-pointer"
              >
                All
              </button>

              <button
                onClick={() => onChange({ ...config, providers: [] })}
                className="text-[11px] text-text-muted hover:underline cursor-pointer"
              >
                None
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ALL_PROVIDERS.map((p) => {
              const active = providers.includes(p.id);

              return (
                <button
                  key={p.id}
                  onClick={() => toggleProvider(p.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer',

                    active
                      ? 'bg-primary/10 border-primary/30 text-primary'
                      : 'bg-surface-2 border-border-subtle text-text-muted hover:border-primary/20 hover:text-text-main'
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Concurrent */}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Concurrent Browsers
            </span>

            <span className="text-xs font-bold text-primary">{concurrent}</span>
          </div>

          <input
            type="range"
            min={1}
            max={10}
            value={concurrent}
            onChange={(e) =>
              onChange({ ...config, concurrent: Number(e.target.value) })
            }
            className="w-full accent-primary"
          />

          <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
            <span>1</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        {/* Proxy */}

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
            Proxy URL
          </label>

          <input
            type="text"
            value={proxy}
            onChange={(e) => onChange({ ...config, proxy: e.target.value })}
            placeholder="http://user:pass@host:port"
            className="w-full text-xs font-mono bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>

        {/* Dashboard API Key */}

        <div>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
            Dashboard API Key
          </label>

          <div className="relative" ref={dropdownRef}>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
                  onFocus={() => availableKeys.length > 0 && setShowKeyDropdown(true)}
                  placeholder="sk-… (from Settings → API Keys)"
                  className="w-full text-xs font-mono bg-surface-2 border border-border-subtle rounded-lg px-3 py-2 pr-8 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main"
                  tabIndex={-1}
                >
                  <span className="material-symbols-outlined text-[15px]">
                    {showApiKey ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              {apiKey && (
                <button
                  type="button"
                  onClick={() => onChange({ ...config, apiKey: '' })}
                  className="px-2 rounded-lg bg-surface-2 border border-border-subtle text-text-muted hover:text-red-500 transition-colors"
                  title="Clear API key"
                >
                  <span className="material-symbols-outlined text-[15px]">close</span>
                </button>
              )}
            </div>

            {/* Dropdown: pick from existing API keys */}
            {showKeyDropdown && availableKeys.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 z-50 bg-surface border border-border-subtle rounded-lg shadow-lg overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] text-text-muted border-b border-border-subtle">
                  Select an existing API key
                </div>
                <div className="max-h-40 overflow-y-auto">
                  {availableKeys.map((k, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onChange({ ...config, apiKey: k.key ?? k });
                        setShowKeyDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-mono text-text-main hover:bg-surface-2 truncate"
                    >
                      {k.name && <span className="text-primary mr-2">{k.name}</span>}
                      {(k.key ?? k).slice(0, 12)}…
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="mt-1.5 text-[10px] text-text-muted">
            Used to authenticate harvest results to the 9router dashboard. Generate in{' '}
            <a href="/dashboard/profile" className="text-primary hover:underline">
              Settings → API Keys
            </a>.
          </p>
        </div>

        {/* Display Mode */}

        <div>
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-2">
            Display Mode
          </span>

          <div className="space-y-1.5">
            {DISPLAY_MODES.map((mode) => {
              const active = displayMode === mode.id;

              return (
                <button
                  key={mode.id}
                  onClick={() => onChange({ ...config, displayMode: mode.id })}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer',

                    active
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border-subtle bg-surface-2 text-text-muted hover:border-primary/20 hover:text-text-main'
                  )}
                >
                  <span
                    className={cn(
                      'material-symbols-outlined text-[16px] shrink-0',
                      active ? 'text-primary' : ''
                    )}
                  >
                    {mode.icon}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-none mb-0.5">
                      {mode.label}
                    </p>

                    <p className="text-[10px] opacity-70 truncate">
                      {mode.desc}
                    </p>
                  </div>

                  {active && (
                    <span className="material-symbols-outlined text-[14px] text-primary shrink-0">
                      check_circle
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {displayMode === 'virtual' && (
            <p className="mt-2 text-[10px] text-amber-500 flex items-start gap-1">
              <span className="material-symbols-outlined text-[12px] mt-px shrink-0">
                warning
              </span>

              <span>
                Requires Xvfb on server:{' '}
                <code className="font-mono">
                  Xvfb :99 -screen 0 1280x800x24 &amp;
                </code>
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
