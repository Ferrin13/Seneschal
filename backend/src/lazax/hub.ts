import WebSocket from "ws";

export type LazaxClient = {
  socket: WebSocket;
  gameId: string;
  userId: string;
};

const rooms = new Map<string, Set<LazaxClient>>();

const HEARTBEAT_MS = 25_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const clients of rooms.values()) {
      for (const client of clients) {
        if (client.socket.readyState === WebSocket.OPEN) {
          try {
            client.socket.send(JSON.stringify({ type: "ping", t: Date.now() }));
          } catch {
            // drop on next cleanup
          }
        }
      }
    }
  }, HEARTBEAT_MS);
  // Don't keep the process alive solely for heartbeats in tests.
  if (typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) {
    heartbeatTimer.unref();
  }
}

export function subscribe(client: LazaxClient) {
  let set = rooms.get(client.gameId);
  if (!set) {
    set = new Set();
    rooms.set(client.gameId, set);
  }
  set.add(client);
  ensureHeartbeat();

  client.socket.on("close", () => unsubscribe(client));
  client.socket.on("error", () => unsubscribe(client));
}

export function unsubscribe(client: LazaxClient) {
  const set = rooms.get(client.gameId);
  if (!set) return;
  set.delete(client);
  if (set.size === 0) rooms.delete(client.gameId);
}

export function broadcastGame(gameId: string, snapshot: unknown) {
  const set = rooms.get(gameId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify({ type: "snapshot", data: snapshot });
  for (const client of set) {
    if (client.socket.readyState === WebSocket.OPEN) {
      try {
        client.socket.send(payload);
      } catch {
        unsubscribe(client);
      }
    }
  }
}

export function roomSize(gameId: string): number {
  return rooms.get(gameId)?.size ?? 0;
}
