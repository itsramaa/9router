"use client";

import { useState, useCallback, useEffect } from "react";
import ConnectionBar from "./components/ConnectionBar";
import AccountsPanel from "./components/AccountsPanel";
import ConfigPanel from "./components/ConfigPanel";
import ControlBar from "./components/ControlBar";
import SlotDetail from "./components/SlotDetail";
import AccountProgress from "./components/AccountProgress";
import LiveLog from "./components/LiveLog";
import ResultsPanel from "./components/ResultsPanel";
import InteractModal from "./components/InteractModal";
import { useAutomationWS } from "./hooks/useAutomationWS";

const DEFAULT_SERVER_URL = "http://localhost:8765";
const DEFAULT_CONFIG = {
  providers: ["kiro", "openrouter"],
  concurrent: 2,
  proxy: "",
  displayMode: "headless",
};
const MAX_LOG = 500;

function getWsUrl(serverUrl) {
  try { return serverUrl.replace(/^http/, "ws") + "/ws"; }
  catch { return "ws://localhost:8765/ws"; }
}

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

// Derive headless param from displayMode
function getHeadless(displayMode) {
  return displayMode !== "headed";
}

export default function AutomationPage() {
  const [serverUrl, setServerUrl]         = useState(DEFAULT_SERVER_URL);
  const [wsStatus, setWsStatus]           = useState("disconnected");
  const [accounts, setAccounts]           = useState([]);
  const [config, setConfig]               = useState(DEFAULT_CONFIG);
  const [runState, setRunState]           = useState("idle");

  // slots: { index, email, provider, message, status }
  const [slots, setSlots]                 = useState([]);
  // frames: { [slotIndex]: base64string }
  const [frames, setFrames]               = useState({});
  // accountProgress: { [email]: { email, slot, status, steps: [{provider, status}], currentMessage } }
  const [accountProgress, setAccountProgress] = useState({});
  // pendingInteract: { [slotIndex]: { index, email, provider, reason } }
  const [pendingInteract, setPendingInteract] = useState({});
  // which slot's InteractModal is open
  const [interactOpen, setInteractOpen]   = useState(null);

  const [logEntries, setLogEntries]       = useState([]);
  const [results, setResults]             = useState([]);

  // Load accounts + results on mount
  useEffect(() => {
    fetch("/api/automation/api/accounts")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.accounts)) setAccounts(d.accounts); })
      .catch(() => {});
    fetch("/api/automation/api/results")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.results)) setResults(d.results); })
      .catch(() => {});
  }, [serverUrl]);

  const pushLog = useCallback((entry) => {
    setLogEntries((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }, []);

  // Update per-account progress state machine
  const updateAccountProgress = useCallback((email, slotIdx, patch) => {
    if (!email) return;
    setAccountProgress((prev) => {
      const existing = prev[email] ?? { email, slot: slotIdx, status: "pending", steps: [], currentMessage: "" };
      return { ...prev, [email]: { ...existing, ...patch } };
    });
  }, []);

  const handleMessage = useCallback((msg) => {
    const entry = { ...msg, ts: ts() };
    pushLog(entry);

    // --- Frame update ---
    if (msg.type === "frame" && msg.slot != null && msg.base64) {
      setFrames((prev) => ({ ...prev, [msg.slot]: msg.base64 }));
      return; // frames are high-frequency, skip other processing
    }

    // --- Interact required ---
    if (msg.type === "interact_required" && msg.slot != null) {
      setPendingInteract((prev) => ({
        ...prev,
        [msg.slot]: { index: msg.slot, email: msg.email, provider: msg.provider, reason: msg.reason },
      }));
      setSlots((prev) => prev.map((s) => s.index === msg.slot ? { ...s, status: "interact" } : s));
      updateAccountProgress(msg.email, msg.slot, { status: "interact", currentMessage: msg.reason });
      return;
    }

    // --- Interact done ---
    if (msg.type === "interact_done" && msg.slot != null) {
      setPendingInteract((prev) => { const n = { ...prev }; delete n[msg.slot]; return n; });
      setSlots((prev) => prev.map((s) => s.index === msg.slot ? { ...s, status: "running" } : s));
      return;
    }

    // --- Slot progress update ---
    if (msg.slot != null) {
      const newStatus =
        msg.type === "error"  ? "error"   :
        msg.type === "result" ? "done"    : "running";

      setSlots((prev) => {
        const idx = prev.findIndex((s) => s.index === msg.slot);
        const updated = {
          index: msg.slot,
          email: msg.email ?? prev[idx]?.email ?? "",
          provider: msg.provider ?? prev[idx]?.provider ?? "",
          message: msg.message ?? msg.error ?? "",
          status: newStatus,
        };
        if (idx === -1) return [...prev, updated];
        const next = [...prev]; next[idx] = updated; return next;
      });

      // Update account progress steps
      const email = msg.email;
      if (email && msg.provider) {
        setAccountProgress((prev) => {
          const acc = prev[email] ?? { email, slot: msg.slot, status: "running", steps: [], currentMessage: "" };
          const stepIdx = acc.steps.findIndex((s) => s.provider === msg.provider);
          const stepStatus =
            msg.type === "error"   ? "error"   :
            msg.type === "api_key" ? "success" :
            msg.type === "result"  ? "success" : "running";
          let steps = [...acc.steps];
          if (stepIdx === -1) steps = [...steps, { provider: msg.provider, status: stepStatus }];
          else { steps = [...steps]; steps[stepIdx] = { ...steps[stepIdx], status: stepStatus }; }
          const accStatus =
            msg.type === "result" ? "done" :
            msg.type === "error" && msg.provider === "_session" ? "error" : "running";
          return {
            ...prev,
            [email]: { ...acc, slot: msg.slot, steps, status: accStatus, currentMessage: msg.message ?? msg.error ?? "" },
          };
        });
      }
    }

    // --- Harvest api_key result ---
    if (msg.type === "api_key" && msg.provider && msg.email) {
      setResults((prev) => [...prev, { provider: msg.provider, email: msg.email, key: msg.key_preview ?? "" }]);
    }

    // --- Batch result ---
    if (msg.type === "result" && msg.api_keys) {
      const email = msg.email ?? "";
      const newKeys = Object.entries(msg.api_keys).map(([provider, key]) => ({
        provider, email, key: typeof key === "string" ? key : String(key),
      }));
      if (newKeys.length > 0) {
        setResults((prev) => {
          const existing = new Set(prev.map((r) => `${r.provider}:${r.email}`));
          return [...prev, ...newKeys.filter((k) => !existing.has(`${k.provider}:${k.email}`))];
        });
      }
      setRunState((prev) => prev === "running" ? "done" : prev);
    }

    if (msg.type === "progress" && msg.step === "done") {
      setRunState((prev) => prev === "running" ? "done" : prev);
    }
  }, [pushLog, updateAccountProgress]);

  const handleStatusChange = useCallback((s) => setWsStatus(s), []);
  useAutomationWS(getWsUrl(serverUrl), handleMessage, handleStatusChange, true);

  // --- Interact action handler ---
  async function handleInteractAction(slotIdx, action) {
    await fetch("/api/automation/api/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slotIdx, action }),
    });
  }

  // --- Start ---
  async function handleStart() {
    if (accounts.length === 0) {
      pushLog({ type: "error", ts: ts(), message: "No accounts configured." }); return;
    }
    if (config.providers.length === 0) {
      pushLog({ type: "error", ts: ts(), message: "No providers selected." }); return;
    }
    setRunState("running");
    setSlots([]);
    setFrames({});
    setAccountProgress({});
    setPendingInteract({});
    try {
      const res = await fetch("/api/automation/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: config.providers,
          concurrent: config.concurrent,
          proxy: config.proxy || undefined,
          headless: getHeadless(config.displayMode),
          display_mode: config.displayMode,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        pushLog({ type: "error", ts: ts(), message: `Start failed: ${err}` });
        setRunState("idle");
      }
    } catch (e) {
      pushLog({ type: "error", ts: ts(), message: `Start failed: ${e.message}` });
      setRunState("idle");
    }
  }

  async function handleStop() {
    setRunState("stopping");
    try { await fetch("/api/automation/api/stop", { method: "POST" }); } catch { /* ignore */ }
    setRunState("idle");
  }

  async function handleReset() {
    setSlots([]); setFrames({}); setLogEntries([]); setResults([]);
    setAccountProgress({}); setPendingInteract({}); setRunState("idle");
    try { await fetch("/api/automation/api/reset", { method: "POST" }); } catch { /* ignore */ }
  }

  const accountList = Object.values(accountProgress);
  const interactSlot = interactOpen != null ? pendingInteract[interactOpen] : null;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[20px]">smart_toy</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-main">Automation</h1>
          <p className="text-xs text-text-muted">Bulk API key harvester — bulk-accounts server</p>
        </div>
        {/* Pending interact badges */}
        {Object.keys(pendingInteract).length > 0 && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <span className="material-symbols-outlined text-[16px] text-blue-500 animate-pulse">touch_app</span>
            <span className="text-xs font-semibold text-blue-500">
              {Object.keys(pendingInteract).length} slot{Object.keys(pendingInteract).length > 1 ? "s" : ""} waiting for interaction
            </span>
          </div>
        )}
      </div>

      <ConnectionBar status={wsStatus} serverUrl={serverUrl} onServerUrlChange={setServerUrl} />
      <ControlBar runState={runState} onStart={handleStart} onStop={handleStop} onReset={handleReset} disabled={wsStatus !== "connected"} />

      {/* Config + Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccountsPanel accounts={accounts} onChange={setAccounts} serverUrl={serverUrl} />
        <ConfigPanel config={config} onChange={setConfig} />
      </div>

      {/* Live slot grid with screenshots */}
      {slots.length > 0 && (
        <div className="rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <span className="material-symbols-outlined text-[18px] text-primary">view_module</span>
            <h2 className="text-sm font-semibold text-text-main">Browser Slots</h2>
            <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">{slots.length}</span>
          </div>
          <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {slots.map((slot) => (
              <SlotDetail
                key={slot.index}
                slot={slot}
                frame={frames[slot.index] ?? null}
                onInteract={(idx) => setInteractOpen(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Per-account progress */}
      {accountList.length > 0 && <AccountProgress accounts={accountList} />}

      <LiveLog entries={logEntries} onClear={() => setLogEntries([])} />
      <ResultsPanel results={results} />

      {/* InteractModal */}
      {interactOpen != null && interactSlot && (
        <InteractModal
          slot={interactSlot}
          frame={frames[interactOpen] ?? null}
          onAction={handleInteractAction}
          onClose={() => setInteractOpen(null)}
        />
      )}
    </div>
  );
}
