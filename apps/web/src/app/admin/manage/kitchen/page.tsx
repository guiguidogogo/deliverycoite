"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch, readApiJson } from "../../../../lib/api";

type OrderStatus = "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FINISHED" | "CANCELED";
type OrderSource = "DELIVERY" | "TABLE" | "COUNTER" | "WAITER";
type FulfillmentType = "DELIVERY" | "PICKUP";

type KitchenOrder = {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  source?: OrderSource;
  fulfillmentType: FulfillmentType;
  paymentMethod?: "CASH" | "PIX" | "CARD" | "MERCADO_PAGO";
  paidAt?: string | null;
  mercadoPagoStatus?: string | null;
  createdAt: string;
  total: number;
  customerNotes?: string | null;
  notes?: string | null;
  customer: {
    name: string;
    phone?: string | null;
    address?: string | null;
    number?: string | null;
    district?: string | null;
    complement?: string | null;
  };
  table?: { number: number; name?: string | null; area?: { name: string } | null } | null;
  waiter?: { name: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    product: { name: string };
    complements: Array<{ id: string; name: string; quantity: number; price: number; total: number }>;
  }>;
};

type Column = {
  status: OrderStatus;
  title: string;
  description: string;
  empty: string;
  accent: string;
};

const SOUND_KEY = "hubregional:kitchen-sound-enabled";

const columns: Column[] = [
  {
    status: "RECEIVED",
    title: "Novos",
    description: "Pedidos que acabaram de entrar",
    empty: "Nenhum pedido novo.",
    accent: "border-amber-300 bg-amber-50"
  },
  {
    status: "PREPARING",
    title: "Em preparo",
    description: "Pedidos em producao",
    empty: "Nada em preparo.",
    accent: "border-orange-300 bg-orange-50"
  },
  {
    status: "OUT_FOR_DELIVERY",
    title: "Prontos",
    description: "Entrega, retirada ou mesa",
    empty: "Nenhum pedido pronto.",
    accent: "border-emerald-300 bg-emerald-50"
  }
];

function orderCode(order: KitchenOrder) {
  return `#${String(order.orderNumber).padStart(5, "0")}`;
}

function minutesSince(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

function sourceLabel(order: KitchenOrder) {
  if (order.source === "TABLE" && order.table) {
    return `Mesa ${order.table.number}${order.table.area?.name ? ` - ${order.table.area.name}` : ""}`;
  }
  if (order.source === "WAITER") return `Garcom${order.waiter?.name ? ` - ${order.waiter.name}` : ""}`;
  if (order.source === "COUNTER") return "Balcao";
  return order.fulfillmentType === "PICKUP" ? "Retirada na loja" : "Delivery";
}

function nextAction(order: KitchenOrder): { label: string; status: OrderStatus; className: string } | null {
  if (order.status === "RECEIVED") {
    return { label: "Iniciar preparo", status: "PREPARING", className: "bg-orange-600 text-white" };
  }
  if (order.status === "PREPARING") {
    if (order.source === "TABLE") return { label: "Pronto para mesa", status: "OUT_FOR_DELIVERY", className: "bg-emerald-600 text-white" };
    if (order.fulfillmentType === "PICKUP") return { label: "Pronto para retirada", status: "OUT_FOR_DELIVERY", className: "bg-emerald-600 text-white" };
    return { label: "Pronto para entrega", status: "OUT_FOR_DELIVERY", className: "bg-emerald-600 text-white" };
  }
  if (order.status === "OUT_FOR_DELIVERY" && (order.source === "TABLE" || order.fulfillmentType === "PICKUP")) {
    return { label: order.source === "TABLE" ? "Entregue na mesa" : "Finalizar retirada", status: "FINISHED", className: "bg-ink text-white" };
  }
  return null;
}

function beep(audio: AudioContext) {
  const first = audio.createOscillator();
  const second = audio.createOscillator();
  const gain = audio.createGain();
  first.type = "sine";
  second.type = "triangle";
  first.frequency.setValueAtTime(900, audio.currentTime);
  second.frequency.setValueAtTime(660, audio.currentTime + 0.18);
  first.connect(gain);
  second.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.65);
  first.start();
  second.start(audio.currentTime + 0.18);
  first.stop(audio.currentTime + 0.34);
  second.stop(audio.currentTime + 0.68);
}

export default function KitchenPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(SOUND_KEY) === "true"
  );
  const audioRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const knownReceivedRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const storedToken = token ?? localStorage.getItem("delivery:token");
    if (!storedToken) throw new Error("Sessao expirada");
    const response = await apiFetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${storedToken}`,
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem("delivery:token");
        router.replace("/admin/login");
      }
      const payload = await readApiJson<any>(response).catch(() => ({}));
      throw new Error(payload.message ?? "Falha na API");
    }
    if (response.status === 204) return undefined as T;
    return readApiJson<T>(response);
  }, [router, token]);

  function playSound() {
    if (!soundEnabledRef.current || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = audioRef.current ?? new AudioContextClass();
      audioRef.current = audio;
      void audio.resume().then(() => beep(audio)).catch(() => undefined);
    } catch {
      // Som auxiliar. Se o navegador bloquear, o alerta visual continua.
    }
  }

  const loadOrders = useCallback(async (notify = false) => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const loaded = await request<KitchenOrder[]>(`/admin/orders?dateFrom=${today}&dateTo=${today}&includeFinished=false`);
      const normalized = loaded.map((order) => ({ ...order, total: Number(order.total) }));
      setOrders(normalized);

      const receivedIds = new Set(normalized.filter((order) => order.status === "RECEIVED").map((order) => order.id));
      const newOrders = normalized.filter((order) => order.status === "RECEIVED" && !knownReceivedRef.current.has(order.id));
      if (initializedRef.current && notify && newOrders.length > 0) {
        playSound();
        toast.success(newOrders.length === 1 ? `${orderCode(newOrders[0])} entrou na cozinha` : `${newOrders.length} pedidos novos na cozinha`);
      }
      knownReceivedRef.current = receivedIds;
      initializedRef.current = true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar cozinha");
    } finally {
      setLoading(false);
    }
  }, [request]);

  async function updateStatus(order: KitchenOrder, status: OrderStatus) {
    try {
      let reason: string | undefined;
      if (status === "CANCELED" && order.status !== "CANCELED") {
        reason = window.prompt(`Motivo do cancelamento do pedido ${orderCode(order)}:`)?.trim();
        if (!reason) {
          toast.error("Informe o motivo para cancelar");
          return;
        }
      }
      const updated = await request<{ status: OrderStatus }>(`/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason })
      });
      setOrders((current) => current
        .map((item) => item.id === order.id ? { ...item, status: updated.status } : item)
        .filter((item) => !["FINISHED", "CANCELED", "DELIVERED"].includes(item.status))
      );
      toast.success(`${orderCode(order)} atualizado`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar pedido");
    }
  }

  async function enableSound() {
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    localStorage.setItem(SOUND_KEY, "true");
    playSound();
    toast.success("Som da cozinha ativado");
  }

  useEffect(() => {
    const storedToken = localStorage.getItem("delivery:token");
    if (!storedToken) {
      router.replace("/admin/login");
      return;
    }
    setToken(storedToken);
  }, [router]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
    if (soundEnabled) localStorage.setItem(SOUND_KEY, "true");
  }, [soundEnabled]);

  useEffect(() => {
    if (!token) return;
    void loadOrders(false);
    const timer = window.setInterval(() => void loadOrders(true), 10000);
    return () => window.clearInterval(timer);
  }, [token, loadOrders]);

  useEffect(() => {
    if (!token) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws-admin?token=${encodeURIComponent(token)}`;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "new-order") void loadOrders(true);
      };
      socket.onerror = () => setConnected(false);
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) reconnectTimer = window.setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [loadOrders, token]);

  const activeOrders = useMemo(
    () => orders.filter((order) => !["FINISHED", "CANCELED", "DELIVERED"].includes(order.status)),
    [orders]
  );

  const byStatus = useMemo(() => {
    const grouped = new Map<OrderStatus, KitchenOrder[]>();
    columns.forEach((column) => grouped.set(column.status, []));
    activeOrders.forEach((order) => {
      if (grouped.has(order.status)) grouped.get(order.status)!.push(order);
    });
    return grouped;
  }, [activeOrders]);

  if (!token) return <p className="p-6">Redirecionando para o login...</p>;

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Producao</p>
          <h1 className="font-display text-5xl leading-none">Cozinha / KDS</h1>
          <p className="mt-1 text-sm opacity-70">Acompanhe pedidos novos, preparo e pedidos prontos em tempo real.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-2 text-xs font-bold ${connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {connected ? "Tempo real ativo" : "Polling ativo"}
          </span>
          <button
            className={`rounded-xl px-3 py-2 font-bold text-white ${soundEnabled ? "bg-emerald-600" : "bg-slate-700"}`}
            onClick={() => void enableSound()}
          >
            {soundEnabled ? "Som ativo" : "Ativar som"}
          </button>
          <button className="rounded-xl border px-3 py-2 font-bold" onClick={() => void loadOrders(false)}>
            Atualizar
          </button>
          <Link className="rounded-xl bg-ink px-3 py-2 font-bold text-white" href="/admin">Voltar</Link>
        </div>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Na fila" value={byStatus.get("RECEIVED")?.length ?? 0} />
        <Metric label="Em preparo" value={byStatus.get("PREPARING")?.length ?? 0} />
        <Metric label="Prontos" value={byStatus.get("OUT_FOR_DELIVERY")?.length ?? 0} />
        <Metric label="Total ativo" value={activeOrders.length} />
      </section>

      {loading && <p className="mt-4 rounded-2xl bg-white/80 p-4 text-sm font-bold">Carregando pedidos...</p>}

      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        {columns.map((column) => {
          const list = byStatus.get(column.status) ?? [];
          return (
            <div key={column.status} className={`min-h-[420px] rounded-3xl border p-3 ${column.accent}`}>
              <div className="mb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-3xl">{column.title}</h2>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-black">{list.length}</span>
                </div>
                <p className="text-sm opacity-70">{column.description}</p>
              </div>
              <div className="space-y-3">
                {!list.length && <p className="rounded-2xl bg-white/70 p-4 text-sm font-bold opacity-70">{column.empty}</p>}
                {list.map((order) => <OrderCard key={order.id} order={order} onUpdate={(status) => void updateStatus(order, status)} />)}
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-white/80 p-4">
      <p className="text-sm opacity-70">{label}</p>
      <p className="text-3xl font-black">{value}</p>
    </div>
  );
}

function OrderCard({ order, onUpdate }: { order: KitchenOrder; onUpdate: (status: OrderStatus) => void }) {
  const action = nextAction(order);
  const age = minutesSince(order.createdAt);
  const mercadoPagoPending = order.paymentMethod === "MERCADO_PAGO" && !order.paidAt && order.mercadoPagoStatus !== "refunded";

  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xl font-black">{orderCode(order)}</p>
          <p className="text-sm font-bold text-ember">{sourceLabel(order)}</p>
          <p className="text-xs opacity-60">{age <= 0 ? "agora" : `${age} min na fila`}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-black ${age >= 25 ? "bg-red-100 text-red-700" : age >= 15 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
          {age} min
        </span>
      </div>

      <div className="mt-3">
        <p className="font-bold">{order.customer.name}</p>
        {mercadoPagoPending && <p className="mt-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">Aguardando pagamento Mercado Pago</p>}
      </div>

      <div className="mt-3 space-y-2">
        {order.items.map((item) => (
          <div key={item.id} className="rounded-xl bg-slate-50 p-3">
            <p className="font-black">{item.quantity}x {item.product.name}</p>
            {!!item.complements?.length && (
              <ul className="mt-1 space-y-1 text-xs opacity-75">
                {item.complements.map((complement) => (
                  <li key={complement.id}>+ {complement.quantity}x {complement.name}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {(order.customerNotes || order.notes) && (
        <div className="mt-3 rounded-xl border border-dashed p-3 text-sm">
          <p className="font-black">Observacoes</p>
          {order.customerNotes && <p>{order.customerNotes}</p>}
          {order.notes && <p>{order.notes}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {action && (
          <button
            className={`flex-1 rounded-xl px-3 py-3 text-sm font-black ${action.className}`}
            disabled={mercadoPagoPending}
            onClick={() => onUpdate(action.status)}
          >
            {mercadoPagoPending ? "Aguardando pagamento" : action.label}
          </button>
        )}
        <button className="rounded-xl border border-red-200 px-3 py-3 text-sm font-black text-red-700" onClick={() => onUpdate("CANCELED")}>
          Cancelar
        </button>
      </div>
    </article>
  );
}
