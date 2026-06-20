"use client";

import { cn } from "@/shared/utils/cn";

const ALL_PROVIDERS = [
  { id: "kiro",       label: "Kiro" },
  { id: "xai",        label: "xAI" },
  { id: "qoder",      label: "Qoder" },
  { id: "siliconflow",label: "SiliconFlow" },
  { id: "kilo_code",  label: "Kilo Code" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "deno",       label: "Deno Deploy" },
  { id: "gemini",     label: "Gemini" },
  { id: "groq",       label: "Groq" },
  { id: "cerebras",   label: "Cerebras" },
  { id: "cohere",     label: "Cohere" },
];

export default function ConfigPanel({ config, onChange }) {
  const { providers, concurrent, proxy, headless } = config;

  function toggleProvider(id) {
    onChange({
      ...config,
      providers: providers.includes(id)
        ? providers.filter((p) => p !== id)
        : [...providers, id],
    });
  }

  function selectAll() {
    onChange({ ...config, providers: ALL_PROVIDERS.map((p) => p.id) });
  }

  function clearAll() {
    onChange({ ...config, providers: [] });
  }

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
        <h2 className="text-sm font-semibold text-text-main">Configuration</h2>
      </div>

      <div className="p-4 space-y-5">
        {/* Providers */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Providers</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-[11px] text-primary hover:underline cursor-pointer">All</button>
              <button onClick={clearAll} className="text-[11px] text-text-muted hover:underline cursor-pointer">None</button>
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
                    "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer",
                    active
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-surface-2 border-border-subtle text-text-muted hover:border-primary/20 hover:text-text-main"
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
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Concurrent Browsers</span>
            <span className="text-xs font-bold text-primary">{concurrent}</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={concurrent}
            onChange={(e) => onChange({ ...config, concurrent: Number(e.target.value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-text-muted mt-0.5">
            <span>1</span><span>5</span><span>10</span>
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

        {/* Headless */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-text-main">Headless Mode</span>
            <p className="text-[11px] text-text-muted mt-0.5">Hide browser windows during harvest</p>
          </div>
          <button
            role="switch"
            aria-checked={headless}
            onClick={() => onChange({ ...config, headless: !headless })}
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0",
              headless ? "bg-primary" : "bg-surface-2 border border-border-subtle"
            )}
          >
            <span className={cn(
              "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
              headless ? "translate-x-5" : "translate-x-0.5"
            )} />
          </button>
        </div>
      </div>
    </div>
  );
}
