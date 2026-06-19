"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../lib/api";

function toInputDate(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

type Dashboard = {
  ordersToday: number;
  salesToday: number;
  salesMonth: number;
  avgTicket: number;
  pendingOrders: number;
  topSelling: Array<{ product: string; quantity: number }>;
};

type Order = {
  id: string;
  orderNumber: number;
  status: "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FINISHED" | "CANCELED";
  fulfillmentType: "DELIVERY" | "PICKUP";
  total: number;
  createdAt: string;
  customer: { name: string; phone: string; address: string; number: string; district: string };
  items: Array<{
    id: string;
    quantity: number;
    product: { name: string };
    complements: Array<{ id: string; name: string; quantity: number; price: number; total: number }>;
  }>;
  viewedByStaff: boolean;
  sentToDelivery: boolean;
  customerNotes?: string | null;
  notes?: string | null;
};

const labels: Record<Order["status"], string> = {
  RECEIVED: "Recebido",
  PREPARING: "Em preparo",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  FINISHED: "Finalizado",
  CANCELED: "Cancelado"
};

async function authApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
  } catch {
    throw new Error("Servidor indisponivel. Verifique se a API esta ligada.");
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = payload.message ?? "Erro na API";

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem("delivery:token");
      if (typeof window !== "undefined") {
        window.location.href = "/admin/login";
      }
    }

    throw new Error(message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

function beep(audio: AudioContext) {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.frequency.value = 840;
  gain.gain.setValueAtTime(0.25, audio.currentTime);
  oscillator.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
  oscillator.stop(audio.currentTime + 0.4);
}

export function AdminPanel() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => toInputDate(new Date()));
  const [dateTo, setDateTo] = useState(() => toInputDate(new Date()));
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<string>("");
  const [ordersPaused, setOrdersPaused] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const knownNewOrdersRef = useRef<Set<string>>(new Set());
  const initializedOrdersRef = useRef(false);

  useEffect(() => {
    const storedToken = localStorage.getItem("delivery:token");
    if (!storedToken) {
      router.push("/admin/login");
      return;
    }
    setToken(storedToken);
    void authApi<{ permissions: string[]; role: string }>("/admin/me", storedToken)
      .then((me) => {
        setPermissions(me.permissions);
        setUserRole(me.role);
      })
      .catch(() => undefined);
    void fetch(`${API_URL}/settings`, { cache: "no-store" })
      .then((response) => response.json())
      .then((settings) => setOrdersPaused(Boolean(settings.ordersPaused)));
  }, [router]);

  const can = useCallback(
    (permission: string) => permissions.includes("*") || permissions.includes(permission),
    [permissions]
  );

  async function toggleStorePause() {
    if (!token) return;
    const reason = ordersPaused
      ? null
      : window.prompt("Motivo da pausa para mostrar aos clientes:", "Pausamos temporariamente devido ao excesso de pedidos.");
    if (!ordersPaused && reason === null) return;
    try {
      const settings = await authApi<{ ordersPaused: boolean }>("/admin/store/pause", token, {
        method: "PATCH",
        body: JSON.stringify({
          ordersPaused: !ordersPaused,
          ordersPausedReason: ordersPaused ? null : reason
        })
      });
      setOrdersPaused(settings.ordersPaused);
      toast.success(settings.ordersPaused ? "Loja pausada para novos pedidos" : "Loja reaberta");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar loja");
    }
  }

  const refreshPanel = useCallback(async (notifyNewOrders = false) => {
    if (!token) return;

    try {
      const [dash, list, notify] = await Promise.all([
        authApi<Dashboard>("/admin/dashboard", token),
        authApi<Order[]>(
          `/admin/orders?status=${filterStatus}&customer=${encodeURIComponent(search)}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          token
        ),
        authApi<{ count: number; orders: Array<{ id: string; customer: { name: string } }> }>(
          "/admin/notifications/new-orders",
          token
        )
      ]);

      setDashboard(dash);
      setOrders(list.map((order: any) => ({ ...order, total: Number(order.total) })));

      const currentIds = new Set(notify.orders.map((order) => order.id));
      const newOrders = notify.orders.filter((order) => !knownNewOrdersRef.current.has(order.id));

      if (initializedOrdersRef.current && notifyNewOrders && newOrders.length > 0) {
        if (audioRef.current && soundEnabled) {
          void audioRef.current.resume().then(() => beep(audioRef.current!)).catch(() => undefined);
        }
        toast.success(
          newOrders.length === 1
            ? `Novo pedido de ${newOrders[0].customer.name}`
            : `${newOrders.length} novos pedidos recebidos`
        );
      }

      knownNewOrdersRef.current = currentIds;
      initializedOrdersRef.current = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/401|403|token|expir/i.test(message)) {
        localStorage.removeItem("delivery:token");
        router.replace("/admin/login");
        return;
      }
      toast.error(message || "Nao foi possivel conectar ao servidor.");
    }
  }, [token, filterStatus, search, dateFrom, dateTo, router, soundEnabled]);

  useEffect(() => {
    if (!token) return;
    void refreshPanel(false);

    const timer = window.setInterval(() => void refreshPanel(true), 5000);
    const onFocus = () => void refreshPanel(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshPanel(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, refreshPanel]);

  useEffect(() => {
    if (!token) return;

    const wsUrl = (() => {
      if (API_URL.startsWith("http://") || API_URL.startsWith("https://")) {
        const apiBase = new URL(API_URL);
        const wsProtocol = apiBase.protocol === "https:" ? "wss:" : "ws:";
        return `${wsProtocol}//${apiBase.host}/ws-admin?token=${token}`;
      }

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${wsProtocol}//${window.location.host}/ws-admin?token=${token}`;
    })();

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    function connect() {
      if (stopped) return;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.type === "new-order") void refreshPanel(true);
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
  }, [token, refreshPanel]);

  async function enableSound() {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      toast.error("Este navegador nao permite aviso sonoro");
      return;
    }

    const audio = audioRef.current ?? new AudioContextClass();
    audioRef.current = audio;
    await audio.resume();
    beep(audio);
    setSoundEnabled(true);
    toast.success("Aviso sonoro ativado");
  }

  const filteredOrders = useMemo(() => {
    if (!onlyNew) return orders;
    return orders.filter((order) => !order.viewedByStaff);
  }, [orders, onlyNew]);

  if (!token) {
    return <p className="p-6">Acesse /admin/login para entrar.</p>;
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Painel Administrativo</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded-full px-3 py-2 ${connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {connected ? "Aguardando novos pedidos" : "Reconectando..."}
          </span>
          <button
            className={`rounded-full px-3 py-2 ${soundEnabled ? "bg-emerald-600 text-white" : "bg-ink text-white"}`}
            onClick={() => void enableSound()}
          >
            {soundEnabled ? "Som ativado" : "Ativar som"}
          </button>
        </div>
      </div>

      <section className="mt-3 flex flex-wrap gap-2">
        <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/account">
          Minha conta
        </a>
        {userRole === "SUPER_ADMIN" && <a className="rounded-lg bg-violet-700 px-3 py-2 text-sm text-white" href="/admin/companies">
          Empresas
        </a>}
        {can("CATALOG") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/products">
          Produtos
        </a>}
        {can("CATALOG") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/categories">
          Categorias
        </a>}
        {can("CATALOG") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/complements">
          Complementos
        </a>}
        {can("SETTINGS") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/settings">
          Configuracoes
        </a>}
        {can("CUSTOMERS") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/customers">
          Clientes
        </a>}
        {can("COUPONS") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/coupons">
          Cupons
        </a>}
        {can("REPORTS") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/reports">
          Relatorios
        </a>}
        {can("FINANCE") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/finance">
          Financeiro / Caixa
        </a>}
        {can("USERS") && <a className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin/manage/users">
          Usuarios e Acessos
        </a>}
        {can("STORE_PAUSE") && (
          <button
            className={`rounded-lg px-3 py-2 text-sm text-white ${ordersPaused ? "bg-emerald-600" : "bg-red-600"}`}
            onClick={() => void toggleStorePause()}
          >
            {ordersPaused ? "Reabrir loja" : "Pausar novos pedidos"}
          </button>
        )}
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Metric title="Pedidos Hoje" value={dashboard?.ordersToday ?? 0} />
        <Metric title="Faturamento Hoje" value={`R$ ${(dashboard?.salesToday ?? 0).toFixed(2)}`} />
        <Metric title="Faturamento Mes" value={`R$ ${(dashboard?.salesMonth ?? 0).toFixed(2)}`} />
        <Metric title="Ticket Medio" value={`R$ ${(dashboard?.avgTicket ?? 0).toFixed(2)}`} />
        <Metric title="Pendentes" value={dashboard?.pendingOrders ?? 0} />
        <Metric title="Top Produto" value={dashboard?.topSelling?.[0]?.product ?? "-"} />
      </section>

      <section className="mt-5 rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap gap-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" placeholder="Buscar cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="">Todos status</option>
            <option value="RECEIVED">Recebido</option>
            <option value="PREPARING">Em preparo</option>
            <option value="OUT_FOR_DELIVERY">Saiu para entrega</option>
            <option value="DELIVERED">Entregue</option>
            <option value="FINISHED">Finalizado</option>
            <option value="CANCELED">Cancelado</option>
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            Somente novos
          </label>
          {can("REPORTS") && <a className="rounded-xl bg-ink px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/orders.xlsx?dateFrom=${dateFrom}&dateTo=${dateTo}&token=${token}`} target="_blank" rel="noreferrer">
            Exportar Excel
          </a>}
          {can("REPORTS") && <a className="rounded-xl bg-ember px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/orders.pdf?dateFrom=${dateFrom}&dateTo=${dateTo}&token=${token}`} target="_blank" rel="noreferrer">
            Exportar PDF
          </a>}
        </div>

        <div className="mt-4 space-y-2">
          {filteredOrders.map((order) => (
            <article key={order.id} className={`rounded-xl border p-3 ${order.viewedByStaff ? "border-black/10 dark:border-white/10" : "border-amber-500 bg-amber-50 dark:bg-amber-900/20"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">#{String(order.orderNumber).padStart(5, "0")} - {order.customer.name}</p>
                  <p className="text-sm opacity-70">{order.customer.phone}</p>
                  <p className={`text-xs font-semibold ${order.fulfillmentType === "PICKUP" ? "text-violet-600" : "text-blue-600"}`}>
                    {order.fulfillmentType === "PICKUP" ? "Retirada na loja" : "Entrega"}
                  </p>
                  <p className="text-xs opacity-60">{formatDateTime(order.createdAt)}</p>
                  {order.notes?.includes("[PAGO:") && <p className="text-xs text-emerald-600">Pagamento confirmado</p>}
                </div>
                <div className="text-right text-sm">
                  <p>{labels[order.status]}</p>
                  <p className="font-semibold">R$ {order.total.toFixed(2)}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(labels)
                  .filter(([status]) => order.fulfillmentType === "DELIVERY" || status !== "OUT_FOR_DELIVERY")
                  .map(([status, label]) => (
                  <button
                    key={status}
                    className="rounded-lg border border-black/15 px-2 py-1 text-xs dark:border-white/20"
                    disabled={order.status === "FINISHED" && status !== "FINISHED"}
                    onClick={() => {
                      void authApi<{
                        status: Order["status"];
                        statusWhatsappUrl?: string | null;
                        statusWhatsappSent?: boolean;
                      }>(`/admin/orders/${order.id}/status`, token, {
                        method: "PATCH",
                        body: JSON.stringify({ status })
                      }).then(async (payload) => {
                        setOrders((prev) =>
                          payload.status === "FINISHED" && filterStatus !== "FINISHED"
                            ? prev.filter((item) => item.id !== order.id)
                            : prev.map((item) => (item.id === order.id ? { ...item, status: payload.status } : item))
                        );
                        if (payload.statusWhatsappUrl) {
                          window.open(payload.statusWhatsappUrl, "_blank");
                          toast.success("Mensagem de status pronta no WhatsApp");
                        } else if (payload.statusWhatsappSent) {
                          toast.success("Status enviado ao cliente via Menuia");
                        }
                        await refreshPanel(false);
                      }).catch((error) => {
                        toast.error(error instanceof Error ? error.message : "Falha ao atualizar pedido");
                      });
                    }}
                  >
                    {label}
                  </button>
                ))}
                {!order.viewedByStaff && (
                  <button
                    className="rounded-lg bg-lime px-2 py-1 text-xs text-white"
                    onClick={() => {
                      void authApi(`/admin/orders/${order.id}/viewed`, token, { method: "PATCH" }).then(() => {
                        setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, viewedByStaff: true } : item)));
                      });
                    }}
                  >
                    Marcar visualizado
                  </button>
                )}
                {order.fulfillmentType === "DELIVERY"
                  && (order.status === "OUT_FOR_DELIVERY" || order.status === "PREPARING")
                  && !order.sentToDelivery && (
                  <button
                    className="rounded-lg bg-blue-500 px-2 py-1 text-xs text-white"
                    onClick={() => {
                      void authApi<{whatsappUrl: string | null; sentByServer?: boolean}>(`/admin/orders/${order.id}/send-delivery`, token, { method: "POST" }).then((data) => {
                        if (data.whatsappUrl) {
                          window.open(data.whatsappUrl, '_blank');
                        }
                        setOrders((prev) => prev.map((item) => (item.id === order.id ? { ...item, sentToDelivery: true } : item)));
                        toast.success(data.sentByServer ? 'Mensagem enviada para o motoboy via Menuia!' : 'Mensagem pronta no WhatsApp do motoboy');
                      }).catch(() => {
                        toast.error('Configure o número do motoboy nas configurações');
                      });
                    }}
                  >
                    🛵 Enviar para Motoboy
                  </button>
                )}
                {order.status !== "CANCELED" && !order.notes?.includes("[PAGO:") && (
                  <>
                    <button className="rounded-lg bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => setPayingOrderId(order.id)}>
                      Marcar pago
                    </button>
                    {payingOrderId === order.id && (
                      <div className="flex flex-wrap gap-1">
                        {[
                          { label: "Dinheiro", value: "CASH" },
                          { label: "PIX", value: "PIX" },
                          { label: "Debito", value: "DEBIT" },
                          { label: "Credito", value: "CREDIT" }
                        ].map((method) => (
                          <button
                            key={method.value}
                            className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                            onClick={() => {
                              void authApi<{
                                notes?: string | null;
                                paymentWhatsappUrl?: string | null;
                                paymentWhatsappSent?: boolean;
                              }>(`/admin/orders/${order.id}/paid`, token, {
                                method: "PATCH",
                                body: JSON.stringify({ method: method.value })
                              })
                                .then(async (payload) => {
                                  setOrders((prev) =>
                                    prev.map((item) => (item.id === order.id ? { ...item, notes: payload.notes ?? item.notes } : item))
                                  );
                                  if (payload.paymentWhatsappUrl) {
                                    window.open(payload.paymentWhatsappUrl, "_blank");
                                  } else if (payload.paymentWhatsappSent) {
                                    toast.success("Pagamento confirmado enviado via Menuia");
                                  }
                                  window.dispatchEvent(new Event("delivery:payment-updated"));
                                  setPayingOrderId(null);
                                  toast.success("Pagamento registrado");
                                  await refreshPanel(false);
                                })
                                .catch((error) => {
                                  toast.error(error instanceof Error ? error.message : "Falha ao registrar pagamento");
                                });
                            }}
                          >
                            {method.label}
                          </button>
                        ))}
                        <button className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20" onClick={() => setPayingOrderId(null)}>
                          Cancelar
                        </button>
                      </div>
                    )}
                  </>
                )}
                <button
                  className="rounded-lg bg-slate-700 px-2 py-1 text-xs text-white"
                  onClick={() => {
                    void authApi<{ message?: string }>(`/admin/orders/${order.id}/print`, token, { method: "POST" })
                      .then((payload) => toast.success(payload.message ?? "Pedido enviado para impressao"))
                      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao imprimir"));
                  }}
                >
                  Imprimir
                </button>
                {(order.status === "FINISHED" || order.status === "CANCELED") && (
                  <button
                    className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white"
                    onClick={() => {
                      if (!window.confirm("Deseja apagar este pedido?")) return;
                      void authApi(`/admin/orders/${order.id}`, token, { method: "DELETE" })
                        .then(async () => {
                          setOrders((prev) => prev.filter((item) => item.id !== order.id));
                          toast.success("Pedido apagado");
                          await refreshPanel(false);
                        })
                        .catch((error) => {
                          toast.error(error instanceof Error ? error.message : "Falha ao apagar pedido");
                        });
                    }}
                  >
                    Apagar pedido
                  </button>
                )}
                <button className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20" onClick={() => setExpandedOrderId((v) => (v === order.id ? null : order.id))}>
                  {expandedOrderId === order.id ? "Ocultar detalhes" : "Ver detalhes"}
                </button>
              </div>
              {expandedOrderId === order.id && (
                <div className="mt-3 rounded-lg border border-black/10 p-2 text-sm dark:border-white/10">
                  <p className="font-semibold">Itens do pedido</p>
                  <ul className="mt-1 space-y-1">
                    {order.items.map((item) => (
                      <li key={item.id}>
                        • {item.quantity}x {item.product.name}
                        {item.complements?.map((complement) => (
                          <span key={complement.id} className="block pl-4 text-xs opacity-75">
                            + {complement.quantity}x {complement.name}
                            {Number(complement.price) > 0 ? ` (R$ ${Number(complement.price).toFixed(2)})` : ""}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs opacity-80">
                    Observacao: {order.customerNotes || "Sem observacao"}
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white/85 p-3 dark:border-white/10 dark:bg-slate-900/70">
      <p className="text-xs opacity-70">{title}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
