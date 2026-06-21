'use client';

import { cn } from '@/shared/utils/cn';

const RUN_STATES = {
  idle: {
    label: 'Idle',
    color: 'text-text-muted',
    dot: 'bg-surface-2 border border-border-subtle',
  },

  running: {
    label: 'Running',
    color: 'text-green-600 dark:text-green-400',
    dot: 'bg-green-500 animate-pulse',
  },

  stopping: {
    label: 'Stopping',
    color: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-400 animate-pulse',
  },

  done: {
    label: 'Done',
    color: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
};

export default function ControlBar({
  runState,
  onStart,
  onStop,
  onReset,
  onSimulate,
  disabled,
}) {
  const rs = RUN_STATES[runState] ?? RUN_STATES.idle;

  const isRunning = runState === 'running';

  const isStopping = runState === 'stopping';

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] flex-wrap">
      {/* Status */}

      <div className="flex items-center gap-2 mr-auto">
        <span className={cn('w-2 h-2 rounded-full', rs.dot)} />

        <span className={cn('text-xs font-semibold', rs.color)}>
          {rs.label}
        </span>
      </div>

      {/* Reset */}

      <button
        onClick={onReset}
        disabled={isRunning || isStopping}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-xs font-semibold hover:bg-surface-2 hover:text-text-main transition-colors disabled:opacity-40 cursor-pointer"
      >
        <span className="material-symbols-outlined text-[14px]">
          restart_alt
        </span>
        Reset
      </button>

      {/* Stop */}

      <button
        onClick={onStop}
        disabled={!isRunning || isStopping}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 text-red-500 text-xs font-semibold hover:bg-red-500/10 transition-colors disabled:opacity-40 cursor-pointer"
      >
        <span className="material-symbols-outlined text-[14px]">stop</span>
        Stop
      </button>

      {/* Simulate */}

      <button
        onClick={onSimulate}
        disabled={isRunning || isStopping || disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/40 text-amber-500 text-xs font-semibold hover:bg-amber-500/10 transition-colors disabled:opacity-40 cursor-pointer"
        title="Run simulation — no browser, fake keys"
      >
        <span className="material-symbols-outlined text-[14px]">science</span>
        Simulate
      </button>

      {/* Start */}

      <button
        onClick={onStart}
        disabled={isRunning || isStopping || disabled}
        className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 cursor-pointer shadow-[var(--shadow-warm)]"
      >
        <span className="material-symbols-outlined text-[14px]">
          play_arrow
        </span>

        {isStopping ? 'Stopping...' : 'Start Harvest'}
      </button>
    </div>
  );
}
