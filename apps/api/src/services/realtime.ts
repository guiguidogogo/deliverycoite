import http from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";
import { env } from "../utils/env.js";

type AdminPayload = { sub?: string; companyId?: string };

let broadcastFn: ((companyId: string, payload: unknown) => void) | null = null;

export function setRealtimeBroadcaster(fn: (companyId: string, payload: unknown) => void) {
  broadcastFn = fn;
}

export function publishNewOrder(payload: {
  companyId: string;
  orderId: string;
  customer: string;
  total: number;
}) {
  const { companyId, ...publicPayload } = payload;
  broadcastFn?.(companyId, { type: "new-order", payload: publicPayload, at: new Date().toISOString() });
}

export function attachRealtimeServer(server: http.Server) {
  const ws = new WebSocketServer({ server, path: "/ws-admin" });
  const clientCompanies = new WeakMap<object, string>();

  ws.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      socket.close(1008, "Token ausente");
      return;
    }

    try {
      const decoded = jwt.verify(token, env.jwtSecret) as AdminPayload;
      if (!decoded.sub || !decoded.companyId) {
        socket.close(1008, "Sem permissao");
        return;
      }
      clientCompanies.set(socket, decoded.companyId);

      socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
    } catch {
      socket.close(1008, "Token invalido");
    }
  });

  setRealtimeBroadcaster((companyId, payload) => {
    const message = JSON.stringify(payload);
    ws.clients.forEach((client) => {
      if (client.readyState === 1 && clientCompanies.get(client) === companyId) {
        client.send(message);
      }
    });
  });

  const address = server.address() as AddressInfo | null;
  if (address?.port) {
    console.log(`WebSocket admin ativo em ws://localhost:${address.port}/ws-admin`);
  }
}
