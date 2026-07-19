/**
 * UsageScheduler
 * Generic scheduler for periodic background tasks (quota polling, auto-ping, etc.).
 * Generalizes the claudeAutoPing pattern into a reusable, hot-reload-safe scheduler.
 *
 * Usage:
 *   import { register, start } from "@/shared/services/usageScheduler";
 *   register("claude-ping", { tickFn: myTickFn, intervalMs: 60000 });
 *   start(); // idempotent — safe to call multiple times
 */

/**
 * @typedef {object} SchedulerEntry
 * @property {Function} tickFn - Async function called on each tick
 * @property {number} intervalMs - Interval between ticks in ms
 * @property {ReturnType<typeof setInterval>|null} timer - Active interval handle
 * @property {boolean} running - Whether a tick is currently in progress
 * @property {Set<string>} skipConnections - Connection IDs to skip on next tick
 */

// Singleton guard: survives Next.js hot reload
const g = (global.__usageScheduler ??= {
  /** @type {Map<string, SchedulerEntry>} */
  handlers: new Map(),
  started: false,
});

/**
 * Register a scheduler handler.
 * Safe to call before start() — will be picked up on next start().
 * Calling register() after start() on an already-registered id replaces the handler and restarts its timer.
 * @param {string} id - Unique scheduler ID (e.g. "claude-ping")
 * @param {{ tickFn: Function, intervalMs: number }} options
 */
export function register(id, { tickFn, intervalMs }) {
  // Stop existing timer if replacing
  const existing = g.handlers.get(id);
  if (existing?.timer) {
    clearInterval(existing.timer);
  }

  const entry = { tickFn, intervalMs, timer: null, running: false, skipConnections: new Set() };
  g.handlers.set(id, entry);

  // If already started, begin ticking immediately
  if (g.started) {
    _startEntry(id, entry);
  }
}

/**
 * Start all registered schedulers. Idempotent — safe to call multiple times.
 */
export function start() {
  if (g.started) return;
  g.started = true;
  for (const [id, entry] of g.handlers) {
    _startEntry(id, entry);
  }
}

/**
 * Stop a specific scheduler by ID.
 * @param {string} id
 */
export function stop(id) {
  const entry = g.handlers.get(id);
  if (!entry) return;
  if (entry.timer) {
    clearInterval(entry.timer);
    entry.timer = null;
  }
}

/**
 * Stop all schedulers and reset started state.
 */
export function stopAll() {
  for (const [id] of g.handlers) {
    stop(id);
  }
  g.started = false;
}

/**
 * Mark a connection to be skipped on the next tick of a scheduler.
 * The skip is cleared after the tick runs.
 * @param {string} id - Scheduler ID
 * @param {string} connectionId
 */
export function skipConnection(id, connectionId) {
  const entry = g.handlers.get(id);
  if (entry) entry.skipConnections.add(connectionId);
}

/**
 * Get the set of connections currently marked for skipping on a scheduler.
 * @param {string} id
 * @returns {Set<string>}
 */
export function getSkipConnections(id) {
  return g.handlers.get(id)?.skipConnections ?? new Set();
}

// Internal: start timer for a single entry
function _startEntry(id, entry) {
  if (entry.timer) return; // already running

  entry.timer = setInterval(async () => {
    if (entry.running) return; // skip if previous tick still in progress
    entry.running = true;
    try {
      await entry.tickFn({ skipConnections: entry.skipConnections });
    } catch (e) {
      console.warn(`[UsageScheduler] ${id} tick error:`, e.message);
    } finally {
      entry.skipConnections.clear();
      entry.running = false;
    }
  }, entry.intervalMs);

  if (entry.timer.unref) entry.timer.unref();
}