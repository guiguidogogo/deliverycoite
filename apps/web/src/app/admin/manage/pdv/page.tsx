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

type Product = {
  id: string;
  name: string;
  price: number | string;
  promoPrice?: number | string | null;
  available: boolean;
  active: boolean;
  complements?: Array<{
    id: string;
    complementId: string;
    required: boolean;
    complement: {
      id: string;
      name: string;
      description?: string | null;
      price: number | string;
      active: boolean;
    };
  }>;
};

type DraftItem = {
  id: string;
  productId: string;
  quantity: number;
  complements: Array<{ complementId: string; quantity: number }>;
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
  const [products, setProducts] = useState<Product[]>([]);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null);
  const [configuringQuantity, setConfiguringQuantity] = useState(1);
  const [configuringComplements, setConfiguringComplements] = useState<Record<string, number>>({});
  const [draftCustomerName, setDraftCustomerName] = useState("Cliente da mesa");
  const [draftNotes, setDraftNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
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

  const draftTotal = useMemo(() => draftItems.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) return sum;
    const complements = item.complements.reduce((acc, selected) => {
      const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
      return acc + Number(link?.complement.price ?? 0) * selected.quantity;
    }, 0);
    return sum + (Number(product.promoPrice ?? product.price) + complements) * item.quantity;
  }, 0), [draftItems, products]);

  const configuringTotal = useMemo(() => {
    if (!configuringProduct) return 0;
    const complements = (configuringProduct.complements ?? []).reduce((sum, link) =>
      sum + Number(link.complement.price) * (configuringComplements[link.complementId] ?? 0), 0);
    return (Number(configuringProduct.promoPrice ?? configuringProduct.price) + complements) * configuringQuantity;
  }, [configuringComplements, configuringProduct, configuringQuantity]);

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

  async function loadProducts() {
    try {
      const loaded = await request("/admin/products");
      setProducts((loaded ?? []).filter((product: Product) => product.active !== false && product.available !== false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar produtos");
    }
  }

  async function loadOrders(table: RestaurantTable) {
    setSelectedTable(table);
    setDraftItems([]);
    setDraftProductId("");
    setDraftQuantity(1);
    setDraftNotes("");
    setDraftCustomerName("Cliente da mesa");
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

  function addDraftItem() {
    if (!draftProductId) return;
    const product = products.find((item) => item.id === draftProductId);
    if (!product) return;
    setConfiguringProduct(product);
    setConfiguringQuantity(draftQuantity);
    setConfiguringComplements(Object.fromEntries(
      (product.complements ?? [])
        .filter((link) => link.required && link.complement.active)
        .map((link) => [link.complementId, 1])
    ));
  }

  function confirmConfiguredItem() {
    if (!configuringProduct) return;
    const missing = (configuringProduct.complements ?? []).find((link) =>
      link.required && link.complement.active && (configuringComplements[link.complementId] ?? 0) <= 0
    );
    if (missing) {
      toast.error(`O complemento ${missing.complement.name} e obrigatorio`);
      return;
    }
    const complements = Object.entries(configuringComplements)
      .filter(([, quantity]) => quantity > 0)
      .map(([complementId, quantity]) => ({ complementId, quantity }));
    setDraftItems((current) => [
      ...current,
      {
        id: `${configuringProduct.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        productId: configuringProduct.id,
        quantity: configuringQuantity,
        complements
      }
    ]);
    setConfiguringProduct(null);
    setConfiguringQuantity(1);
    setConfiguringComplements({});
    setDraftProductId("");
    setDraftQuantity(1);
  }

  async function createTableOrder() {
    if (!selectedTable || !draftItems.length || savingOrder) return;
    setSavingOrder(true);
    try {
      await request(`/admin/tables/${selectedTable.id}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerName: draftCustomerName || "Cliente da mesa",
          notes: draftNotes || undefined,
          paymentMethod: "PIX",
          items: draftItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            complements: item.complements
          }))
        })
      });
      toast.success("Pedido enviado para a cozinha");
      setDraftItems([]);
      setDraftNotes("");
      await loadOrders(selectedTable);
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar pedido");
    } finally {
      setSavingOrder(false);
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
    void loadProducts();
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

            <section className="mt-5 rounded-3xl border bg-orange-50 p-4 text-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-ember">Garçom / PDV</p>
                  <h3 className="text-xl font-black">Adicionar itens na mesa</h3>
                </div>
                <strong className="rounded-full bg-white px-3 py-1 text-ember">{brl(draftTotal)}</strong>
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-[1.5fr_.6fr_auto]">
                <select className="rounded-xl border px-3 py-2" value={draftProductId} onChange={(event) => setDraftProductId(event.target.value)}>
                  <option value="">Escolha um produto</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} - {brl(product.promoPrice ?? product.price)}
                    </option>
                  ))}
                </select>
                <input className="rounded-xl border px-3 py-2" type="number" min={1} value={draftQuantity} onChange={(event) => setDraftQuantity(Math.max(1, Number(event.target.value || 1)))} />
                <button className="rounded-xl bg-ink px-4 py-2 font-bold text-white" onClick={addDraftItem}>Adicionar</button>
              </div>

              <input className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="Nome do cliente opcional" value={draftCustomerName} onChange={(event) => setDraftCustomerName(event.target.value)} />
              <textarea className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="Observação da cozinha: sem cebola, ponto da carne, etc." value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />

              {draftItems.length > 0 && (
                <div className="mt-3 space-y-2">
                  {draftItems.map((item) => {
                    const product = products.find((candidate) => candidate.id === item.productId);
                    if (!product) return null;
                    const complementTotal = item.complements.reduce((sum, selected) => {
                      const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
                      return sum + Number(link?.complement.price ?? 0) * selected.quantity;
                    }, 0);
                    const itemTotal = (Number(product.promoPrice ?? product.price) + complementTotal) * item.quantity;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3">
                        <div>
                          <p className="font-black">{item.quantity}x {product.name}</p>
                          {item.complements.map((selected) => {
                            const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
                            if (!link) return null;
                            return <p key={selected.complementId} className="text-xs opacity-70">+ {selected.quantity}x {link.complement.name}</p>;
                          })}
                          <p className="text-sm opacity-70">{brl(itemTotal)}</p>
                        </div>
                        <button className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white" onClick={() => setDraftItems((current) => current.filter((draft) => draft.id !== item.id))}>
                          Remover
                        </button>
                      </div>
                    );
                  })}
                  <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white disabled:opacity-60" disabled={savingOrder} onClick={() => void createTableOrder()}>
                    {savingOrder ? "Enviando..." : "Enviar pedido para cozinha"}
                  </button>
                </div>
              )}
            </section>

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

      {configuringProduct && (
        <section className="fixed inset-0 z-[60] bg-black/60 p-3 md:flex md:items-center md:justify-center" onClick={() => setConfiguringProduct(null)}>
          <div className="mx-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-4 shadow-2xl dark:bg-slate-950" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ember">Montar item</p>
                <h2 className="text-2xl font-black">{configuringProduct.name}</h2>
                <p className="mt-1 text-sm opacity-70">Base: {brl(configuringProduct.promoPrice ?? configuringProduct.price)}</p>
              </div>
              <button className="rounded-full bg-black/5 px-4 py-2 font-bold dark:bg-white/10" onClick={() => setConfiguringProduct(null)}>Fechar</button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-orange-50 p-3 text-slate-950">
              <span className="font-black">Quantidade</span>
              <div className="flex items-center gap-2">
                <button className="grid h-9 w-9 place-items-center rounded-full bg-white font-black" disabled={configuringQuantity <= 1} onClick={() => setConfiguringQuantity((value) => Math.max(1, value - 1))}>-</button>
                <strong className="min-w-8 text-center">{configuringQuantity}</strong>
                <button className="grid h-9 w-9 place-items-center rounded-full bg-ink font-black text-white" onClick={() => setConfiguringQuantity((value) => value + 1)}>+</button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(configuringProduct.complements ?? []).filter((link) => link.complement.active).length ? (
                (configuringProduct.complements ?? []).filter((link) => link.complement.active).map((link) => {
                  const quantity = configuringComplements[link.complementId] ?? 0;
                  return (
                    <article key={link.id} className={`rounded-2xl border p-3 ${quantity ? "border-ember bg-orange-50 text-slate-950" : "border-black/10 dark:border-white/10"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black">{link.complement.name}</p>
                          {link.complement.description && <p className="text-xs opacity-65">{link.complement.description}</p>}
                          <p className="mt-1 text-sm font-bold text-ember">{Number(link.complement.price) > 0 ? `+ ${brl(link.complement.price)}` : "Sem adicional"}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-black ${link.required ? "bg-red-100 text-red-700" : "bg-black/5 dark:bg-white/10"}`}>
                          {link.required ? "Obrigatorio" : "Opcional"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full bg-black/10 font-black disabled:opacity-40"
                          disabled={link.required && quantity <= 1}
                          onClick={() => setConfiguringComplements((current) => ({ ...current, [link.complementId]: Math.max(link.required ? 1 : 0, quantity - 1) }))}
                        >
                          -
                        </button>
                        <strong className="min-w-8 text-center">{quantity}</strong>
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full bg-ink font-black text-white"
                          onClick={() => setConfiguringComplements((current) => ({ ...current, [link.complementId]: quantity + 1 }))}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm opacity-70">Este produto nao possui complementos.</div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-100 p-3 text-slate-950">
              <div>
                <p className="text-xs font-bold uppercase opacity-60">Total do item</p>
                <p className="text-2xl font-black text-ember">{brl(configuringTotal)}</p>
              </div>
              <button className="rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white" onClick={confirmConfiguredItem}>
                Adicionar à comanda
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
