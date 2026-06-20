"use client";

import { useEffect, useRef, useCallback } from "react";

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
  enabledRef.current = enabled;

  const connect = useCallback(() => {
    if (!enabledRef.current) return;
    onStatusChange("connecting");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      delayRef.current = INITIAL_DELAY;
      onStatusChange("connected");
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {
        // ignore non-JSON frames
      }
    };

    ws.onclose = () => {
      onStatusChange("disconnected");
      if (!enabledRef.current) return;
      timerRef.current = setTimeout(() => {
        delayRef.current = Math.min(delayRef.current * 2, MAX_DELAY);
        connect();
      }, delayRef.current);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [wsUrl, onMessage, onStatusChange]);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      clearTimeout(timerRef.current);
      onStatusChange("disconnected");
      return;
    }
    connect();
    return () => {
      enabledRef.current = false;
      clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [enabled, connect, onStatusChange]);
}
