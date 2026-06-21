"use client";

import { useEffect, useRef } from "react";

const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;

/**
 * Connects to the bulk-accounts WebSocket server and calls onMessage for each
 * JSON-parsed event. Reconnects automatically with exponential backoff.
 *
 * @param {string} wsUrl  - e.g. "ws://localhost:8765/ws"
 * @param {function} onMessage - called with parsed JSON object
 * @param {function} onStatusChange - called with "connecting"|"connected"|"disconnected"
 * @param {boolean} enabled - set false to disable/disconnect
 */
export function useAutomationWS(wsUrl, onMessage, onStatusChange, enabled = true) {
  const wsRef = useRef(null);
  const delayRef = useRef(INITIAL_DELAY);
  const timerRef = useRef(null);
  const enabledRef = useRef(enabled);

  // Keep ref in sync via effect, not during render
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Keep latest callbacks in refs so the connect closure never goes stale
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      clearTimeout(timerRef.current);
      onStatusChangeRef.current("disconnected");
      return;
    }

    let cancelled = false;

    function connect() {
      if (cancelled || !enabledRef.current) return;
      onStatusChangeRef.current("connecting");

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        delayRef.current = INITIAL_DELAY;
        onStatusChangeRef.current("connected");
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onMessageRef.current(data);
        } catch {
          // ignore non-JSON frames
        }
      };

      ws.onclose = () => {
        onStatusChangeRef.current("disconnected");
        if (cancelled || !enabledRef.current) return;
        timerRef.current = setTimeout(() => {
          delayRef.current = Math.min(delayRef.current * 2, MAX_DELAY);
          connect();
        }, delayRef.current);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      enabledRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  // wsUrl change triggers a fresh connection; enabled toggles connect/disconnect
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, wsUrl]);
}
