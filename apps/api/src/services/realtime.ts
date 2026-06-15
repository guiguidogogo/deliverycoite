import http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";
import { env } from "../utils/env.js";

type AdminPayload = { sub?: string };

let broadcastFn: ((payload: unknown) => void) | null = null;

export function setRealtimeBroadcaster(fn: (payload: unknown) => void) {
  broadcastFn = fn;
}

export function publishNewOrder(payload: {
  orderId: string;
  customer: string;
  total: number;
}) {
  broadcastFn?.({ type: "new-order", payload, at: new Date().toISOString() });
}

export function attachRealtimeServer(server: http.Server) {
  const ws = new WebSocketServer({ server, path: "/ws-admin" });

  ws.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Token ausente");
      return;
    }

    try {
      const decoded = jwt.verify(token, env.jwtSecret) as AdminPayload;
      if (!decoded.sub) {
        socket.close(1008, "Sem permissao");
        return;
      }

      socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
    } catch {
      socket.close(1008, "Token invalido");
    }
  });

  setRealtimeBroadcaster((payload) => {
    const message = JSON.stringify(payload);
    ws.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  });

  const address = server.address() as AddressInfo | null;
  if (address?.port) {
    console.log(`WebSocket admin ativo em ws://localhost:${address.port}/ws-admin`);
  }
}
