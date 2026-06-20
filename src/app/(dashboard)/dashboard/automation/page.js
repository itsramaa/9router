"use client";

import { useState, useCallback, useEffect } from "react";
import ConnectionBar from "./components/ConnectionBar";
import AccountsPanel from "./components/AccountsPanel";
import ConfigPanel from "./components/ConfigPanel";
import ControlBar from "./components/ControlBar";
import SlotGrid from "./components/SlotGrid";
import LiveLog from "./components/LiveLog";
import ResultsPanel from "./components/ResultsPanel";
import { useAutomationWS } from "./hooks/useAutomationWS";

const DEFAULT_SERVER_URL = "http://localhost:8765";

const DEFAULT_CONFIG = {
  providers: ["kiro", "openrouter"],
  concurrent: 2,
  proxy: "",
  headless: true,
};

const MAX_LOG = 500;

function getWsUrl(serverUrl) {
  try {
    return serverUrl.replace(/^http/, "ws") + "/ws";
  } catch {
    return "ws://localhost:8765/ws";
  }
}

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export default function AutomationPage() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [accounts, setAccounts] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [runState, setRunState] = useState("idle");
  const [slots, setSlots] = useState([]);
  const [logEntries, setLogEntries] = useState([]);
  const [results, setResults] = useState([]);

  // Load accounts from server on mount / server URL change
  useEffect(() => {
    fetch("/api/automation/api/accounts")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.accounts)) setAccounts(data.accounts);
      })
      .catch(() => {});
  }, [serverUrl]);

  // Load existing results on mount
  useEffect(() => {
    fetch("/api/automation/api/results")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.results)) setResults(data.results);
      })
      .catch(() => {});
  }, [serverUrl]);

  const pushLog = useCallback((entry) => {
    setLogEntries((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
    });
  }, []);

  const handleMessage = useCallback(
    (msg) => {
      const entry = { ...msg, ts: ts() };
      pushLog(entry);

      // Update slot state from any message with a slot index
      if (msg.slot != null) {
        setSlots((prev) => {
          const idx = prev.findIndex((s) => s.index === msg.slot);
          const updated = {
            index: msg.slot,
            email: msg.email ?? prev[idx]?.email ?? "",
            provider: msg.provider ?? prev[idx]?.provider ?? "",
            message: msg.message ?? msg.error ?? "",
            status:
              msg.type === "error"
                ? "error"
                : msg.type === "result"
                ? "done"
                : "running",
          };
          if (idx === -1) return [...prev, updated];
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
      }

      // Collect harvested keys
      if (msg.type === "api_key" && msg.provider && msg.email) {
        setResults((prev) => [
          ...prev,
          {
            provider: msg.provider,
            email: msg.email,
            key: msg.key_preview ?? "",
          },
        ]);
      }

      // Collect keys from result batch
      if (msg.type === "result" && msg.api_keys) {
        const email = msg.email ?? "";
        const newKeys = Object.entries(msg.api_keys).map(([provider, key]) => ({
          provider,
          email,
          key: typeof key === "string" ? key : String(key),
        }));
        if (newKeys.length > 0) {
          setResults((prev) => {
            const existing = new Set(prev.map((r) => `${r.provider}:${r.email}`));
            const fresh = newKeys.filter((k) => !existing.has(`${k.provider}:${k.email}`));
            return [...prev, ...fresh];
          });
        }
      }

      // Detect run completion
      if (msg.type === "result" || (msg.type === "progress" && msg.step === "done")) {
        setRunState((prev) => (prev === "running" ? "done" : prev));
      }
    },
    [pushLog]
  );

  const handleStatusChange = useCallback((s) => setWsStatus(s), []);

  useAutomationWS(
    getWsUrl(serverUrl),
    handleMessage,
    handleStatusChange,
    true
  );

  async function handleStart() {
    if (accounts.length === 0) {
      pushLog({ type: "error", ts: ts(), message: "No accounts configured. Add accounts first." });
      return;
    }
    if (config.providers.length === 0) {
      pushLog({ type: "error", ts: ts(), message: "No providers selected." });
      return;
    }
    setRunState("running");
    setSlots([]);
    try {
      const res = await fetch("/api/automation/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: config.providers,
          concurrent: config.concurrent,
          proxy: config.proxy || undefined,
          headless: config.headless,
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
    try {
      await fetch("/api/automation/api/stop", { method: "POST" });
    } catch (e) {
      pushLog({ type: "error", ts: ts(), message: `Stop failed: ${e.message}` });
    }
    setRunState("idle");
  }

  async function handleReset() {
    setSlots([]);
    setLogEntries([]);
    setResults([]);
    setRunState("idle");
    try {
      await fetch("/api/automation/api/reset", { method: "POST" });
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-9 rounded-lg bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[20px]">smart_toy</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-text-main">Automation</h1>
          <p className="text-xs text-text-muted">Bulk API key harvester via bulk-accounts server</p>
        </div>
      </div>

      {/* Connection bar */}
      <ConnectionBar
        status={wsStatus}
        serverUrl={serverUrl}
        onServerUrlChange={setServerUrl}
      />

      {/* Control bar */}
      <ControlBar
        runState={runState}
        onStart={handleStart}
        onStop={handleStop}
        onReset={handleReset}
        disabled={wsStatus !== "connected"}
      />

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AccountsPanel
          accounts={accounts}
          onChange={setAccounts}
          serverUrl={serverUrl}
        />
        <ConfigPanel config={config} onChange={setConfig} />
      </div>

      {/* Slot grid — only shown when there are active slots */}
      {slots.length > 0 && <SlotGrid slots={slots} />}

      {/* Log + Results */}
      <LiveLog entries={logEntries} onClear={() => setLogEntries([])} />
      <ResultsPanel results={results} />
    </div>
  );
}
