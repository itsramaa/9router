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
import ServerManager from "./components/ServerManager";
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

function getHeadless(displayMode) {
  return displayMode !== "headed";
}

export default function AutomationPage() {
  const [serverUrl, setServerUrl]             = useState(DEFAULT_SERVER_URL);
  const [wsEnabled, setWsEnabled]             = useState(false);
  const [wsStatus, setWsStatus]               = useState("disconnected");
  const [accounts, setAccounts]               = useState([]);
  const [config, setConfig]                   = useState(DEFAULT_CONFIG);
  const [runState, setRunState]               = useState("idle");
  const [slots, setSlots]                     = useState([]);
  const [frames, setFrames]                   = useState({});
  const [accountProgress, setAccountProgress] = useState({});
  const [pendingInteract, setPendingInteract] = useState({});
  const [interactOpen, setInteractOpen]       = useState(null);
  const [logEntries, setLogEntries]           = useState([]);
  const [results, setResults]                 = useState([]);

  // Load accounts + results on mount / serverUrl change
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

  const updateAccountProgress = useCallback((email, slotIdx, patch) => {
    if (!email) return;
    setAccountProgress((prev) => {
      const existing = prev[email] ?? { email, slot: slotIdx, status: "pending", steps: [], currentMessage: "" };
      return { ...prev, [email]: { ...existing, ...patch } };
    });
  }, []);

  const handleMessage = useCallback((msg) => {
    // frames are high-frequency — handle first and skip log pipeline
    if (msg.type === "frame" && msg.slot != null && msg.base64) {
      setFrames((prev) => ({ ...prev, [msg.slot]: msg.base64 }));
      return;
    }

    pushLog({ ...msg, ts: ts() });

    if (msg.type === "interact_required" && msg.slot != null) {
      setPendingInteract((prev) => ({
        ...prev,
        [msg.slot]: { index: msg.slot, email: msg.email, provider: msg.provider, reason: msg.reason },
      }));
      setSlots((prev) => prev.map((s) => s.index === msg.slot ? { ...s, status: "interact" } : s));
      updateAccountProgress(msg.email, msg.slot, { status: "interact", currentMessage: msg.reason });
      return;
    }

    if (msg.type === "interact_done" && msg.slot != null) {
      setPendingInteract((prev) => { const n = { ...prev }; delete n[msg.slot]; return n; });
      setSlots((prev) => prev.map((s) => s.index === msg.slot ? { ...s, status: "running" } : s));
      return;
    }

    if (msg.slot != null) {
      const newStatus = msg.type === "error" ? "error" : msg.type === "result" ? "done" : "running";
      setSlots((prev) => {
        const idx = prev.findIndex((s) => s.index === msg.slot);
        const updated = {
          index:    msg.slot,
          email:    msg.email    ?? prev[idx]?.email    ?? "",
          provider: msg.provider ?? prev[idx]?.provider ?? "",
          message:  msg.message  ?? msg.error           ?? "",
          status:   newStatus,
        };
        if (idx === -1) return [...prev, updated];
        const next = [...prev]; next[idx] = updated; return next;
      });

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

    if (msg.type === "api_key" && msg.provider && msg.email) {
      setResults((prev) => [...prev, { provider: msg.provider, email: msg.email, key: msg.key_preview ?? "" }]);
    }

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
        // Auto-inject full keys directly into 9router providerConnections DB
        for (const { provider, key, email: kEmail } of newKeys) {
          fetch("/api/automation/inject-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider, key, email: kEmail, name: kEmail }),
          }).catch(() => {});
        }
      }
      setRunState((prev) => prev === "running" ? "done" : prev);
    }

    if (msg.type === "progress" && msg.step === "done") {
      setRunState((prev) => prev === "running" ? "done" : prev);
    }
  }, [pushLog, updateAccountProgress]);

  const handleStatusChange = useCallback((s) => setWsStatus(s), []);
  useAutomationWS(getWsUrl(serverUrl), handleMessage, handleStatusChange, wsEnabled);

  // Called by ServerManager when server starts — auto-update URL + connect WS
  const handleServerReady = useCallback((port) => {
    const url = `http://localhost:${port}`;
    setServerUrl(url);
    setWsEnabled(true);
  }, []);

  async function handleInteractAction(slotIdx, action) {
    await fetch("/api/automation/api/interact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: slotIdx, action }),
    });
  }

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

  const accountList  = Object.values(accountProgress);
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
        {Object.keys(pendingInteract).length > 0 && (
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <span className="material-symbols-outlined text-[16px] text-blue-500 animate-pulse">touch_app</span>
            <span className="text-xs font-semibold text-blue-500">
              {Object.keys(pendingInteract).length} slot{Object.keys(pendingInteract).length > 1 ? "s" : ""} waiting
            </span>
          </div>
        )}
      </div>

      {/* Server Manager — spawn Python process */}
      <ServerManager onServerReady={handleServerReady} />

      {/* WS Connection bar */}
      <ConnectionBar
        status={wsStatus}
        serverUrl={serverUrl}
        onServerUrlChange={setServerUrl}
        enabled={wsEnabled}
        onToggle={() => setWsEnabled((v) => !v)}
      />

      {/* Harvest control */}
      <ControlBar
        runState={runState}
        onStart={handleStart}
        onStop={handleStop}
        onReset={handleReset}
        disabled={wsStatus !== "connected"}
      />

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

      {accountList.length > 0 && <AccountProgress accounts={accountList} />}

      <LiveLog entries={logEntries} onClear={() => setLogEntries([])} />
      <ResultsPanel results={results} />

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
