'use client';

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
  const { providers, concurrent, proxy, displayMode = 'headless' } = config;

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
