"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";

type TableStatus = "FREE" | "OCCUPIED" | "WAITING_PAYMENT" | "RESERVED" | "CLEANING";

type DiningArea = {
  id: string;
  name: string;
};

type RestaurantTable = {
  id: string;
  number: number;
  name?: string | null;
  seats: number;
  status: TableStatus;
  active: boolean;
  qrCodeUrl: string;
  area?: DiningArea | null;
  _count?: { orders: number };
};

type TableOrder = {
  id: string;
  orderNumber: number;
  status: "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FINISHED" | "CANCELED";
  total: number | string;
  subtotal: number | string;
  discount: number | string;
  createdAt: string;
  customer: { name: string; phone: string };
  waiter?: { name: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    price: number | string;
    total: number | string;
    product: { name: string };
    complements: Array<{ id: string; name: string; quantity: number; total: number | string }>;
  }>;
};

const statusLabels: Record<TableStatus, string> = {
  FREE: "Livre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Aguardando pagamento",
  RESERVED: "Reservada",
  CLEANING: "Em limpeza"
};

const statusStyles: Record<TableStatus, string> = {
  FREE: "border-emerald-300 bg-emerald-100 text-emerald-900",
  OCCUPIED: "border-orange-300 bg-orange-100 text-orange-900",
  WAITING_PAYMENT: "border-red-300 bg-red-100 text-red-900",
  RESERVED: "border-slate-300 bg-slate-100 text-slate-900",
  CLEANING: "border-blue-300 bg-blue-100 text-blue-900"
};

const orderStatusLabels: Record<TableOrder["status"], string> = {
  RECEIVED: "Recebido",
  PREPARING: "Em preparo",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  FINISHED: "Finalizado",
  CANCELED: "Cancelado"
};

function brl(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export default function PdvPage() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [areaFilter, setAreaFilter] = useState("all");

  const areas = useMemo(() => {
    const byId = new Map<string, DiningArea>();
    tables.forEach((table) => {
      if (table.area) byId.set(table.area.id, table.area);
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tables]);

  const filteredTables = useMemo(
    () => tables.filter((table) => table.active && (areaFilter === "all" || table.area?.id === areaFilter)),
    [areaFilter, tables]
  );

  const totals = useMemo(() => {
    const openOrders = orders.filter((order) => !["FINISHED", "CANCELED"].includes(order.status));
    return {
      count: openOrders.length,
      total: openOrders.reduce((sum, order) => sum + Number(order.total), 0),
      items: openOrders.reduce((sum, order) => sum + order.items.reduce((acc, item) => acc + item.quantity, 0), 0)
    };
  }, [orders]);

  async function request(path: string, init?: RequestInit) {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return null;
    }
    const response = await apiFetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message ?? "Falha na requisicao");
    return payload;
  }

  async function loadTables() {
    setLoading(true);
    try {
      const loaded = await request("/admin/tables");
      setTables(loaded ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar PDV");
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders(table: RestaurantTable) {
    setSelectedTable(table);
    setLoadingOrders(true);
    try {
      const loaded = await request(`/admin/tables/${table.id}/orders`);
      setOrders(loaded ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar pedidos da mesa");
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }

  async function updateStatus(table: RestaurantTable, status: TableStatus) {
    try {
      const updated = await request(`/admin/tables/${table.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setTables((current) => current.map((item) => item.id === table.id ? { ...item, ...updated } : item));
      if (selectedTable?.id === table.id) setSelectedTable((current) => current ? { ...current, ...updated } : current);
      toast.success(`Mesa ${table.number}: ${statusLabels[status]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar mesa");
    }
  }

  async function updateOrderStatus(order: TableOrder, status: TableOrder["status"]) {
    try {
      const updated = await request(`/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: updated.status } : item));
      toast.success("Pedido atualizado");
      if (selectedTable) await loadOrders(selectedTable);
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar pedido");
    }
  }

  useEffect(() => {
    void loadTables();
    const timer = window.setInterval(() => void loadTables(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Atendimento presencial</p>
          <h1 className="font-display text-5xl leading-none">PDV de Mesas</h1>
          <p className="mt-1 text-sm opacity-70">Mapa operacional para acompanhar mesas, pedidos e fechamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="rounded-xl border px-3 py-2 font-bold" href="/admin/manage/tables">Cadastrar mesas</Link>
          <Link className="rounded-xl bg-ink px-3 py-2 font-bold text-white" href="/admin">Voltar</Link>
        </div>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(statusLabels) as TableStatus[]).map((status) => (
          <div key={status} className={`rounded-2xl border p-3 ${statusStyles[status]}`}>
            <p className="text-2xl font-black">{tables.filter((table) => table.status === status && table.active).length}</p>
            <p className="text-sm font-bold">{statusLabels[status]}</p>
          </div>
        ))}
      </section>

      <section className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${areaFilter === "all" ? "bg-ink text-white" : "bg-white/80"}`} onClick={() => setAreaFilter("all")}>
          Todos setores
        </button>
        {areas.map((area) => (
          <button key={area.id} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${areaFilter === area.id ? "bg-ink text-white" : "bg-white/80"}`} onClick={() => setAreaFilter(area.id)}>
            {area.name}
          </button>
        ))}
      </section>

      {loading ? (
        <section className="mt-4 rounded-3xl border bg-white/80 p-8 text-center">Carregando mesas...</section>
      ) : (
        <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filteredTables.map((table) => (
            <button
              key={table.id}
              className={`rounded-[2rem] border-2 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${statusStyles[table.status]}`}
              onClick={() => void loadOrders(table)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide opacity-70">{table.area?.name || "Sem setor"}</p>
                  <h2 className="font-display text-5xl leading-none">Mesa {table.number}</h2>
                  <p className="mt-1 font-bold">{table.name || `${table.seats} lugares`}</p>
                </div>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">{statusLabels[table.status]}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-white/65 p-3">
                  <p className="text-xs opacity-70">Pedidos</p>
                  <p className="text-xl font-black">{table._count?.orders ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white/65 p-3">
                  <p className="text-xs opacity-70">QR Code</p>
                  <p className="truncate text-xs font-bold">Abrir mesa</p>
                </div>
              </div>
            </button>
          ))}
          {!filteredTables.length && (
            <div className="rounded-3xl border bg-white/80 p-8 text-center sm:col-span-2 lg:col-span-4">
              <p className="font-black">Nenhuma mesa encontrada.</p>
              <p className="mt-1 text-sm opacity-70">Cadastre mesas em “Mesas / QR Code”.</p>
            </div>
          )}
        </section>
      )}

      {selectedTable && (
        <section className="fixed inset-0 z-50 bg-black/50 p-3 md:flex md:items-center md:justify-center" onClick={() => setSelectedTable(null)}>
          <div className="mx-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-4 shadow-2xl dark:bg-slate-950" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Comanda aberta</p>
                <h2 className="font-display text-5xl leading-none">Mesa {selectedTable.number}</h2>
                <p className="text-sm opacity-70">{selectedTable.area?.name || "Sem setor"} • {statusLabels[selectedTable.status]}</p>
              </div>
              <button className="rounded-full bg-black/5 px-4 py-2 font-bold dark:bg-white/10" onClick={() => setSelectedTable(null)}>Fechar</button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/10">
                <p className="text-xs opacity-70">Pedidos</p>
                <p className="text-2xl font-black">{totals.count}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/10">
                <p className="text-xs opacity-70">Itens</p>
                <p className="text-2xl font-black">{totals.items}</p>
              </div>
              <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-900">
                <p className="text-xs opacity-70">Total</p>
                <p className="text-2xl font-black">{brl(totals.total)}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <a className="rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white" href={selectedTable.qrCodeUrl} target="_blank" rel="noreferrer">
                Abrir cardápio da mesa
              </a>
              <button className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "OCCUPIED")}>Marcar ocupada</button>
              <button className="rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "WAITING_PAYMENT")}>Solicitou conta</button>
              <button className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "FREE")}>Liberar mesa</button>
            </div>

            <div className="mt-5 space-y-3">
              {loadingOrders ? (
                <p className="rounded-2xl border p-4">Carregando pedidos...</p>
              ) : orders.length ? (
                orders.map((order) => (
                  <article key={order.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-black">Pedido #{String(order.orderNumber).padStart(5, "0")}</p>
                        <p className="text-xs opacity-65">{formatDate(order.createdAt)} • {orderStatusLabels[order.status]}</p>
                      </div>
                      <p className="text-lg font-black text-ember">{brl(order.total)}</p>
                    </div>
                    <div className="mt-3 space-y-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">
                          <div className="flex justify-between gap-3">
                            <span><strong>{item.quantity}x</strong> {item.product.name}</span>
                            <strong>{brl(item.total)}</strong>
                          </div>
                          {item.complements.map((complement) => (
                            <p key={complement.id} className="ml-4 text-xs opacity-65">+ {complement.quantity}x {complement.name}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["RECEIVED", "PREPARING", "FINISHED", "CANCELED"] as TableOrder["status"][]).map((status) => (
                        <button key={status} className="rounded-lg border px-3 py-2 text-xs font-bold" onClick={() => void updateOrderStatus(order, status)}>
                          {orderStatusLabels[status]}
                        </button>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-6 text-center">
                  <p className="font-black">Nenhum pedido aberto nesta mesa.</p>
                  <p className="mt-1 text-sm opacity-70">Abra o cardápio da mesa ou leia o QR Code para criar o primeiro pedido.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
