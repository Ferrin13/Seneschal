import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiWsBaseUrl, ApiError } from "../api";
import { auth } from "../firebase";
import type { GameSnapshot } from "./types";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function useLazaxGame(gameId: string | undefined) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(RECONNECT_BASE_MS);
  const disposedRef = useRef(false);

  const applySnapshot = useCallback((snap: GameSnapshot) => {
    setSnapshot(snap);
    setError(null);
    setLoading(false);
  }, []);

  const refetch = useCallback(async () => {
    if (!gameId) return;
    try {
      const snap = await api.lazaxGame(gameId);
      applySnapshot(snap);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load game");
      setLoading(false);
    }
  }, [gameId, applySnapshot]);

  const mutate = useCallback(
    async (action: string, body?: unknown) => {
      if (!gameId) return;
      const snap = await api.lazaxPost(gameId, action, body);
      applySnapshot(snap);
      return snap;
    },
    [gameId, applySnapshot]
  );

  useEffect(() => {
    disposedRef.current = false;
    if (!gameId) return;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (disposedRef.current) return;
      const user = auth.currentUser;
      if (!user) {
        setError("not signed in");
        setLoading(false);
        return;
      }

      try {
        const token = await user.getIdToken();
        const url = `${apiWsBaseUrl()}/lazax/ws?gameId=${encodeURIComponent(gameId)}&token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnected(true);
          backoffRef.current = RECONNECT_BASE_MS;
        };

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              data?: GameSnapshot;
            };
            if (msg.type === "ping") {
              ws.send(JSON.stringify({ type: "pong", t: Date.now() }));
              return;
            }
            if (msg.type === "snapshot" && msg.data) {
              applySnapshot(msg.data);
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsRef.current = null;
          if (disposedRef.current) return;
          void refetch();
          const delay = backoffRef.current;
          backoffRef.current = Math.min(delay * 1.5, RECONNECT_MAX_MS);
          reconnectTimer = setTimeout(() => {
            void connect();
          }, delay);
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : "WebSocket failed");
        setLoading(false);
        reconnectTimer = setTimeout(() => {
          void connect();
        }, backoffRef.current);
      }
    };

    void refetch().then(() => connect());

    return () => {
      disposedRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [gameId, applySnapshot, refetch]);

  // Local clock tick against open segment.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const openElapsedMs = snapshot?.openSegment
    ? Math.max(0, nowMs - new Date(snapshot.openSegment.startedAt).getTime())
    : 0;

  return {
    snapshot,
    loading,
    error,
    connected,
    openElapsedMs,
    refetch,
    mutate,
  };
}
