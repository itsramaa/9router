'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

import { cn } from '@/shared/utils/cn';

async function sendInteract(slotIndex, action) {
  await fetch('/api/automation/api/interact', {
    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({ slot: slotIndex, action }),
  });
}

const STATUS_STYLES = {
  idle: {
    border: 'border-border-subtle',
    bg: '',
    dot: 'bg-border-subtle',
    label: 'Idle',
  },

  running: {
    border: 'border-amber-400/40',
    bg: 'bg-amber-400/5',
    dot: 'bg-amber-400 animate-pulse',
    label: 'Running',
  },

  interact: {
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/5',
    dot: 'bg-blue-500 animate-pulse',
    label: 'Waiting',
  },

  done: {
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
    dot: 'bg-green-500',
    label: 'Done',
  },

  error: {
    border: 'border-red-500/30',
    bg: 'bg-red-500/5',
    dot: 'bg-red-500',
    label: 'Error',
  },
};

const LOG_COLORS = {
  error: 'text-red-400',

  api_key: 'text-green-400 font-semibold',

  result: 'text-blue-400 font-semibold',

  progress: 'text-white/80',

  log: 'text-white/50',
};

const LOG_ICONS = {
  error: 'error',

  api_key: 'key',

  result: 'check_circle',

  progress: 'arrow_right',

  log: 'info',
};

/** Remote control panel — works for any slot status, embedded in zoom modal. */

function RemoteControl({ slot, frame }) {
  const [gotoUrl, setGotoUrl] = useState('');

  const [typeText, setTypeText] = useState('');

  const [busy, setBusy] = useState(false);

  const send = useCallback(
    async (action) => {
      setBusy(true);

      try {
        await sendInteract(slot.index, action);
      } finally {
        setBusy(false);
      }
    },
    [slot.index]
  );

  function handleImgClick(e) {
    const rect = e.currentTarget.getBoundingClientRect();

    const x = Math.round((e.clientX - rect.left) * (1366 / rect.width));

    const y = Math.round((e.clientY - rect.top) * (768 / rect.height));

    send(`click:${x}:${y}`);
  }

  function handleScroll(e) {
    e.preventDefault();

    send(`scroll:0:${e.deltaY > 0 ? 300 : -300}`);
  }

  async function handleGoto() {
    if (!gotoUrl.trim()) return;

    await send(`goto:${gotoUrl.trim()}`);

    setGotoUrl('');
  }

  async function handleType() {
    if (!typeText) return;

    await send(`type:${btoa(unescape(encodeURIComponent(typeText)))}`);

    setTypeText('');
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto">
      {/* Screenshot — clickable */}

      <div
        className="relative rounded-lg overflow-hidden border border-white/10 bg-black/30 cursor-crosshair select-none"
        onWheel={handleScroll}
      >
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt={`Slot ${slot.index}`}
            className="w-full h-auto"
            draggable={false}
            onClick={handleImgClick}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-white/30">
            <span className="material-symbols-outlined text-[32px]">
              hide_image
            </span>

            <span className="text-xs">No screenshot — headless mode</span>

            <p className="text-[10px]">
              Click Refresh to capture current state
            </p>
          </div>
        )}

        {frame && (
          <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full pointer-events-none">
            Click to interact
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[24px] animate-spin">
              sync
            </span>
          </div>
        )}
      </div>

      {/* Navigate */}

      <div>
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
          Navigate to URL
        </label>

        <div className="flex gap-2">
          <input
            type="text"
            value={gotoUrl}
            onChange={(e) => setGotoUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGoto()}
            placeholder="https://..."
            className="flex-1 text-xs font-mono bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />

          <button
            onClick={handleGoto}
            disabled={busy || !gotoUrl.trim()}
            className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors disabled:opacity-40 cursor-pointer shrink-0"
          >
            Go
          </button>
        </div>
      </div>

      {/* Type text */}

      <div>
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
          Type Text
        </label>

        <div className="flex gap-2">
          <input
            type="text"
            value={typeText}
            onChange={(e) => setTypeText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleType()}
            placeholder="Text to type into focused element..."
            className="flex-1 text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-primary/40"
          />

          <button
            onClick={handleType}
            disabled={busy || !typeText}
            className="px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors disabled:opacity-40 cursor-pointer shrink-0"
          >
            Type
          </button>
        </div>
      </div>

      {/* Page actions */}

      <div>
        <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wider block mb-1">
          Page Actions
        </label>

        <div className="flex flex-wrap gap-2">
          {[
            {
              action: 'screenshot',
              icon: 'screenshot_monitor',
              label: 'Refresh',
            },

            { action: 'back', icon: 'arrow_back', label: 'Back' },

            { action: 'reload', icon: 'refresh', label: 'Reload' },

            { action: 'switch_tab:1', icon: 'tab', label: 'Next Tab' },
          ].map((a) => (
            <button
              key={a.action}
              onClick={() => send(a.action)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-white/60 text-xs hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[13px]">
                {a.icon}
              </span>

              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Script interaction controls — only when required */}

      {slot.status === 'interact' && (
        <div className="border-t border-white/10 pt-3 flex gap-2 flex-wrap">
          <span className="text-[10px] text-amber-400 flex items-center gap-1 w-full">
            <span className="material-symbols-outlined text-[12px]">
              warning
            </span>
            Interaction required by script
          </span>

          {[
            {
              action: 'continue',
              label: 'Continue',
              cls: 'bg-blue-500 text-white hover:bg-blue-600',
            },

            {
              action: 'retry',
              label: 'Retry',
              cls: 'border border-white/20 text-white/70 hover:bg-white/10',
            },

            {
              action: 'skip',
              label: 'Skip',
              cls: 'border border-white/20 text-white/70 hover:bg-white/10',
            },

            {
              action: 'abort',
              label: 'Abort',
              cls: 'border border-red-500/30 text-red-400 hover:bg-red-500/10',
            },
          ].map((a) => (
            <button
              key={a.action}
              onClick={() => send(a.action)}
              disabled={busy}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer',
                a.cls
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Full-screen zoom overlay with View + Remote Control tabs and log sidebar. */

function SlotZoomModal({
  slots,
  frames,
  logEntries = [],
  activeIndex,
  onIndexChange,
  onClose,
  onInteract,
  onRetry,
}) {
  const slot = slots[activeIndex];

  const frame = slot ? frames[slot.index] : null;

  const st = STATUS_STYLES[slot?.status] ?? STATUS_STYLES.idle;

  const total = slots.length;

  const [tab, setTab] = useState('view');

  const [showLog, setShowLog] = useState(true);

  const logBottomRef = useRef(null);

  const slotLogs = logEntries.filter(
    (e) => e.slot == null || e.slot === slot?.index
  );

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [slotLogs.length]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();

      if (e.key === 'ArrowLeft' && activeIndex > 0)
        onIndexChange(activeIndex - 1);

      if (e.key === 'ArrowRight' && activeIndex < total - 1)
        onIndexChange(activeIndex + 1);
    }

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, total, onClose, onIndexChange]);

  if (!slot) return null;

  const TABS = [
    { id: 'view', icon: 'monitor', label: 'View' },

    { id: 'remote', icon: 'computer', label: 'Remote' },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Header */}

      <div
        className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className={cn('w-2 h-2 rounded-full shrink-0', st.dot)} />

        <span className="text-sm font-semibold text-white">
          Slot {slot.index}
        </span>

        <span
          className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', {
            'border-amber-400/40 text-amber-400 bg-amber-400/10':
              slot.status === 'running',

            'border-blue-500/40 text-blue-400 bg-blue-500/10':
              slot.status === 'interact',

            'border-green-500/30 text-green-400 bg-green-500/10':
              slot.status === 'done',

            'border-red-500/30 text-red-400 bg-red-500/10':
              slot.status === 'error',

            'border-white/20 text-white/50': ![
              'running',
              'interact',
              'done',
              'error',
            ].includes(slot.status),
          })}
        >
          {st.label}
        </span>

        {slot.email && (
          <span className="text-xs font-mono text-white/60 truncate max-w-[200px]">
            {slot.email}
          </span>
        )}

        {slot.provider && (
          <span className="text-xs text-blue-400/80 truncate">
            {slot.provider}
          </span>
        )}

        <div className="flex-1" />

        {total > 1 && (
          <span className="text-xs text-white/50 font-mono shrink-0">
            {activeIndex + 1} / {total}
          </span>
        )}

        {/* View / Remote tab switcher */}

        <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/10">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer',

                tab === t.id
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/70'
              )}
            >
              <span className="material-symbols-outlined text-[13px]">
                {t.icon}
              </span>

              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Log toggle */}

        <button
          onClick={() => setShowLog((v) => !v)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg border text-xs transition-colors cursor-pointer shrink-0',

            showLog
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-white/20 text-white/40 hover:text-white/70'
          )}
        >
          <span className="material-symbols-outlined text-[14px]">
            terminal
          </span>

          <span className="hidden sm:inline">Log</span>

          {slotLogs.length > 0 && (
            <span className="px-1 rounded-full bg-white/10 text-[10px] font-mono">
              {slotLogs.length}
            </span>
          )}
        </button>

        {/* Retry button — only when slot errored */}

        {slot.status === 'error' && onRetry && (
          <button
            onClick={() => onRetry(slot.index)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/10 transition-colors cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[14px]">
              restart_alt
            </span>

            <span className="hidden sm:inline">Retry</span>
          </button>
        )}

        <button
          onClick={onClose}
          className="text-white/60 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </div>

      {/* Body */}

      <div className="flex-1 flex min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* Main panel */}

        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
          {tab === 'view' ? (
            <div className="flex items-center justify-center p-4 h-full min-h-[200px]">
              {frame ? (
                <img
                  src={`data:image/jpeg;base64,${frame}`}
                  alt={`Slot ${slot.index}`}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/30">
                  <span className="material-symbols-outlined text-[48px]">
                    monitor
                  </span>

                  <span className="text-sm">No screenshot yet</span>

                  <button
                    onClick={() => setTab('remote')}
                    className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 text-white/50 text-xs hover:text-white hover:border-white/40 transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      computer
                    </span>
                    Open Remote Control
                  </button>
                </div>
              )}
            </div>
          ) : (
            <RemoteControl slot={slot} frame={frame} />
          )}
        </div>

        {/* Log sidebar */}

        {showLog && (
          <div className="w-72 shrink-0 border-l border-white/10 flex flex-col min-h-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
              <span className="material-symbols-outlined text-[13px] text-white/40">
                terminal
              </span>

              <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
                Slot {slot.index} Log
              </span>

              <span className="ml-auto text-[10px] text-white/30 font-mono">
                {slotLogs.length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-0.5 font-mono text-[10px]">
              {slotLogs.length === 0 ? (
                <p className="text-white/20 text-center py-6">
                  No log entries yet.
                </p>
              ) : (
                slotLogs.map((e, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-1 leading-relaxed',
                      LOG_COLORS[e.type] ?? LOG_COLORS.log
                    )}
                  >
                    <span className="material-symbols-outlined text-[10px] mt-px shrink-0 opacity-60">
                      {LOG_ICONS[e.type] ?? 'circle'}
                    </span>

                    <span className="opacity-40 shrink-0">{e.ts}</span>

                    {e.provider && (
                      <span className="text-blue-400/60 shrink-0">
                        [{e.provider}]
                      </span>
                    )}

                    <span className="break-all">{e.message ?? e.error}</span>
                  </div>
                ))
              )}

              <div ref={logBottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* Footer: slot nav */}

      {total > 1 && (
        <div
          className="shrink-0 px-5 py-3 border-t border-white/10 flex items-center gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => activeIndex > 0 && onIndexChange(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="text-white/60 hover:text-white disabled:opacity-20 transition-colors cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[22px]">
              chevron_left
            </span>
          </button>

          <div className="flex-1 flex flex-col gap-1.5">
            <input
              type="range"
              min={0}
              max={total - 1}
              value={activeIndex}
              onChange={(e) => onIndexChange(Number(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />

            <div className="flex gap-1.5 justify-center flex-wrap">
              {slots.map((s, i) => {
                const tst = STATUS_STYLES[s.status] ?? STATUS_STYLES.idle;

                return (
                  <button
                    key={s.index}
                    onClick={() => onIndexChange(i)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer',

                      i === activeIndex
                        ? 'border-primary/60 bg-primary/20 text-primary'
                        : 'border-white/15 text-white/50 hover:border-white/30 hover:text-white/80'
                    )}
                  >
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        tst.dot
                      )}
                    />

                    {s.index}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            onClick={() =>
              activeIndex < total - 1 && onIndexChange(activeIndex + 1)
            }
            disabled={activeIndex === total - 1}
            className="text-white/60 hover:text-white disabled:opacity-20 transition-colors cursor-pointer shrink-0"
          >
            <span className="material-symbols-outlined text-[22px]">
              chevron_right
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Single slot card in the grid — click to zoom. */

export default function SlotDetail({
  slot,
  frame,
  onInteract,
  onRetry,
  slots,
  frames,
  slotIndex,
  logEntries,
}) {
  const [zoomed, setZoomed] = useState(false);

  const [zoomIdx, setZoomIdx] = useState(slotIndex ?? 0);

  const st = STATUS_STYLES[slot.status] ?? STATUS_STYLES.idle;

  const hasFrame = Boolean(frame);

  const openZoom = useCallback(() => {
    setZoomIdx(slotIndex ?? 0);

    setZoomed(true);
  }, [slotIndex]);

  async function handleRetry(e) {
    e.stopPropagation();

    if (onRetry) await onRetry(slot.index);
  }

  return (
    <>
      <div
        className={cn(
          'rounded-xl border overflow-hidden transition-colors cursor-zoom-in',
          st.border,
          st.bg
        )}
        onClick={openZoom}
        title="Click to zoom"
      >
        {/* Header */}

        <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/50">
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', st.dot)} />

          <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
            Slot {slot.index}
          </span>

          <span className="material-symbols-outlined text-[11px] text-text-muted/40 ml-0.5">
            zoom_in
          </span>

          <span
            className={cn(
              'text-[10px] font-semibold ml-auto',
              slot.status === 'done'
                ? 'text-green-600 dark:text-green-400'
                : 'text-text-muted'
            )}
          >
            {st.label}
          </span>
        </div>

        {/* Screenshot thumbnail */}

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
              <span className="material-symbols-outlined text-[24px] text-text-muted/40">
                monitor
              </span>

              <span className="text-[10px] text-text-muted/40">
                No screenshot
              </span>
            </div>
          )}

          {slot.status === 'interact' && (
            <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center">
              <div className="bg-surface/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-blue-500/30">
                <span className="material-symbols-outlined text-[16px] text-blue-500 animate-pulse">
                  touch_app
                </span>

                <span className="text-xs font-semibold text-blue-500">
                  Interaction Required
                </span>
              </div>
            </div>
          )}

          {slot.status === 'error' && (
            <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center">
              <div className="bg-surface/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 border border-red-500/30">
                <span className="material-symbols-outlined text-[16px] text-red-500">
                  error
                </span>

                <span className="text-xs font-semibold text-red-500">
                  Failed
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Info */}

        <div className="px-3 py-2 space-y-0.5">
          <p
            className="text-[11px] font-mono text-text-main truncate"
            title={slot.email}
          >
            {slot.email || '—'}
          </p>

          {slot.provider && (
            <p className="text-[10px] text-primary/80 truncate">
              <span className="material-symbols-outlined text-[10px] align-middle mr-0.5">
                arrow_right
              </span>

              {slot.provider}
            </p>
          )}

          {slot.message && (
            <p
              className="text-[10px] text-text-muted truncate"
              title={slot.message}
            >
              {slot.message}
            </p>
          )}
        </div>

        {/* Interact button overlay */}

        {slot.status === 'interact' && onInteract && (
          <div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onInteract(slot.index);
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">
                touch_app
              </span>
              Open Interact
            </button>
          </div>
        )}

        {/* Retry button — shown when slot errored */}

        {slot.status === 'error' && onRetry && (
          <div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleRetry}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">
                restart_alt
              </span>
              Retry
            </button>
          </div>
        )}
      </div>

      {zoomed && (
        <SlotZoomModal
          slots={slots}
          frames={frames}
          logEntries={logEntries}
          activeIndex={zoomIdx}
          onIndexChange={setZoomIdx}
          onClose={() => setZoomed(false)}
          onInteract={onInteract}
          onRetry={onRetry}
        />
      )}
    </>
  );
}
