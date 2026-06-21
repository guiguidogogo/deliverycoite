"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../../../../lib/admin-api";

type Driver = {
  id: string;
  name: string;
  phone: string;
  whatsapp: string;
  vehicle: string;
  licensePlate?: string | null;
  active: boolean;
  available: boolean;
};

type ReadyOrder = {
  id: string;
  orderNumber: number;
  createdAt: string;
  deliveryLatitude?: number | null;
  deliveryLongitude?: number | null;
  customer: {
    name: string;
    phone: string;
    address: string;
    number: string;
    district: string;
    complement?: string | null;
  };
};

type RouteStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";

type DeliveryRoute = {
  id: string;
  status: RouteStatus;
  googleMapsUrl: string;
  whatsappMessage: string;
  createdAt: string;
  driver: Driver;
  orders: Array<{
    id: string;
    sequence: number;
    address: string;
    latitude?: number | null;
    longitude?: number | null;
    order: ReadyOrder;
  }>;
};

const statusLabel: Record<RouteStatus, string> = {
  CREATED: "Aguardando aceite",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluida",
  CANCELED: "Cancelada"
};

const blankDriver = {
  name: "",
  phone: "",
  whatsapp: "",
  vehicle: "Moto",
  licensePlate: "",
  password: ""
};

function orderCode(number: number) {
  return `#${String(number).padStart(5, "0")}`;
}

function orderAddress(order: ReadyOrder) {
  return [
    `${order.customer.address}, ${order.customer.number}`,
    order.customer.district,
    order.customer.complement
  ].filter(Boolean).join(" - ");
}

export default function DeliveriesPage() {
  const [orders, setOrders] = useState<ReadyOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [driverId, setDriverId] = useState("");
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [driverForm, setDriverForm] = useState(blankDriver);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [readyOrders, driverList, routeList] = await Promise.all([
        adminApi<ReadyOrder[]>("/admin/deliveries/orders"),
        adminApi<Driver[]>("/admin/deliveries/drivers"),
        adminApi<DeliveryRoute[]>("/admin/deliveries/routes")
      ]);
      setOrders(readyOrders);
      setDrivers(driverList);
      setRoutes(routeList);
      setDriverId((current) => current || driverList.find((driver) => driver.active)?.id || "");
      setSelected((current) => current.filter((id) => readyOrders.some((order) => order.id === id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar entregas");
    }
  }, []);

  useEffect(() => {
    const requestedOrderId = new URLSearchParams(window.location.search).get("orderId");
    if (requestedOrderId) setSelected([requestedOrderId]);
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const selectedOrders = useMemo(
    () => orders.filter((order) => selected.includes(order.id)),
    [orders, selected]
  );

  function toggleOrder(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  async function saveDriver(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const driver = await adminApi<Driver>("/admin/deliveries/drivers", {
        method: "POST",
        body: JSON.stringify({ ...driverForm, active: true })
      });
      setDriverForm(blankDriver);
      setShowDriverForm(false);
      setDriverId(driver.id);
      toast.success("Motoboy cadastrado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao cadastrar motoboy");
    } finally {
      setSaving(false);
    }
  }

  async function createRoute() {
    if (!selected.length || !driverId) return;
    setSaving(true);
    try {
      const route = await adminApi<DeliveryRoute & {
        push?: { sent: number; errors: string[] };
      }>("/admin/deliveries/routes", {
        method: "POST",
        body: JSON.stringify({ driverId, orderIds: selected })
      });
      setSelected([]);
      setShowRouteModal(false);
      if (route.push?.sent) {
        toast.success("Rota enviada com notificacao push e aguardando aceite");
      } else {
        toast.warning(
          route.push?.errors?.[0]
            ? `Rota criada, mas o push falhou: ${route.push.errors[0]}`
            : "Rota criada. O motoboy ainda nao registrou um aparelho para push."
        );
      }
      await load();
      window.open(route.googleMapsUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar rota");
    } finally {
      setSaving(false);
    }
  }

  const allSelected = orders.length > 0 && orders.every((order) => selected.includes(order.id));

  function toggleAllOrders() {
    setSelected(allSelected ? [] : orders.map((order) => order.id));
  }

  async function updateStatus(route: DeliveryRoute, status: RouteStatus) {
    try {
      await adminApi(`/admin/deliveries/routes/${route.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      toast.success(`Rota ${statusLabel[status].toLowerCase()}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar rota");
    }
  }

  async function toggleDriver(driver: Driver) {
    try {
      await adminApi(`/admin/deliveries/drivers/${driver.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !driver.active })
      });
      toast.success(driver.active ? "Motoboy desativado" : "Motoboy ativado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar motoboy");
    }
  }

  async function resetDriverPassword(driver: Driver) {
    const password = window.prompt(`Nova senha para ${driver.name} (minimo 6 caracteres):`);
    if (!password) return;
    if (password.length < 6) {
      toast.error("A senha precisa ter pelo menos 6 caracteres");
      return;
    }
    try {
      await adminApi(`/admin/deliveries/drivers/${driver.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password })
      });
      toast.success("Senha do motoboy atualizada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar senha");
    }
  }

  function whatsappUrl(route: DeliveryRoute) {
    return `https://wa.me/${route.driver.whatsapp}?text=${encodeURIComponent(route.whatsappMessage)}`;
  }

  function wazeUrl(route: DeliveryRoute) {
    const finalStop = route.orders[route.orders.length - 1];
    if (!finalStop) return "#";
    const query = finalStop.latitude != null && finalStop.longitude != null
      ? `${finalStop.latitude},${finalStop.longitude}`
      : finalStop.address;
    return `https://www.waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">Expedicao</p>
          <h1 className="font-display text-4xl">Entregas e rotas</h1>
        </div>
        <div className="flex gap-2">
          <button className="rounded-xl bg-blue-600 px-4 py-2 text-white" onClick={() => setShowDriverForm(true)}>
            Novo motoboy
          </button>
          <Link className="rounded-xl bg-ink px-4 py-2 text-white" href="/admin">Voltar</Link>
        </div>
      </header>

      <section className="mt-6 rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Pedidos prontos para entrega</h2>
            <p className="text-sm opacity-70">Selecione varios pedidos para montar uma rota otimizada.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-black/15 px-4 py-2 font-semibold dark:border-white/20"
              disabled={!orders.length}
              onClick={toggleAllOrders}
            >
              {allSelected ? "Desmarcar todos" : "Selecionar todos"}
            </button>
            <button
              className="rounded-xl bg-ember px-4 py-2 font-semibold text-white disabled:opacity-50"
              disabled={!selected.length || !drivers.some((driver) => driver.active)}
              onClick={() => setShowRouteModal(true)}
            >
              Enviar para entrega ({selected.length})
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {!orders.length && <p className="rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-800">Nenhum pedido pronto para entrega.</p>}
          {orders.map((order) => (
            <label key={order.id} className="flex cursor-pointer gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
              <input type="checkbox" checked={selected.includes(order.id)} onChange={() => toggleOrder(order.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{orderCode(order.orderNumber)} - {order.customer.name}</strong>
                  <span className="text-xs opacity-60">{new Date(order.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p className="text-sm">{orderAddress(order)}</p>
                <p className="text-xs opacity-60">
                  {order.deliveryLatitude != null && order.deliveryLongitude != null
                    ? "Coordenadas disponiveis"
                    : "Roteamento por endereco textual"}
                </p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Motoboys cadastrados</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {!drivers.length && <p className="text-sm opacity-70">Nenhum motoboy cadastrado.</p>}
          {drivers.map((driver) => (
            <article key={driver.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
              <div>
                <strong>{driver.name}</strong>
                <p className="text-sm">{driver.vehicle}{driver.licensePlate ? ` - ${driver.licensePlate}` : ""}</p>
                <p className="text-xs opacity-60">WhatsApp: {driver.whatsapp}</p>
                <p className={`text-xs font-semibold ${driver.available ? "text-emerald-600" : "text-amber-600"}`}>
                  {driver.available ? "Disponivel" : "Indisponivel"}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <button className="rounded-xl bg-ink px-3 py-2 text-xs text-white" onClick={() => void resetDriverPassword(driver)}>
                  Definir senha
                </button>
                <button
                  className={`rounded-xl px-3 py-2 text-xs text-white ${driver.active ? "bg-red-600" : "bg-emerald-600"}`}
                  onClick={() => void toggleDriver(driver)}
                >
                  {driver.active ? "Desativar" : "Ativar"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-2xl font-bold">Rotas recentes</h2>
        <div className="mt-3 space-y-4">
          {!routes.length && <p className="rounded-xl bg-white/80 p-4 dark:bg-slate-900/70">Nenhuma rota criada.</p>}
          {routes.map((route) => (
            <article key={route.id} className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold">Rota de {route.driver.name}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{statusLabel[route.status]}</span>
                  </div>
                  <p className="text-sm opacity-70">{route.driver.vehicle}{route.driver.licensePlate ? ` - ${route.driver.licensePlate}` : ""}</p>
                  <p className="text-xs opacity-60">{new Date(route.createdAt).toLocaleString("pt-BR")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white" href={route.googleMapsUrl} target="_blank" rel="noreferrer">
                    Abrir no Google Maps
                  </a>
                  <a className="rounded-xl bg-sky-500 px-3 py-2 text-sm text-white" href={wazeUrl(route)} target="_blank" rel="noreferrer">
                    Abrir no Waze
                  </a>
                  <a className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white" href={whatsappUrl(route)} target="_blank" rel="noreferrer">
                    Enviar no WhatsApp
                  </a>
                </div>
              </div>
              <ol className="mt-4 space-y-2">
                {route.orders.map((item) => (
                  <li key={item.id} className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-800">
                    <strong>{item.sequence}. {orderCode(item.order.orderNumber)} - {item.order.customer.name}</strong>
                    <p>{item.address}</p>
                  </li>
                ))}
              </ol>
              {(route.status === "CREATED" || route.status === "IN_PROGRESS") && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {route.status === "CREATED" && (
                    <button className="rounded-xl bg-amber-500 px-3 py-2 text-sm text-white" onClick={() => void updateStatus(route, "IN_PROGRESS")}>
                      Iniciar rota
                    </button>
                  )}
                  <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm text-white" onClick={() => void updateStatus(route, "COMPLETED")}>
                    Concluir rota
                  </button>
                  <button className="rounded-xl bg-red-600 px-3 py-2 text-sm text-white" onClick={() => void updateStatus(route, "CANCELED")}>
                    Cancelar rota
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {showRouteModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 text-ink dark:bg-slate-900 dark:text-white">
            <h2 className="text-xl font-bold">Criar rota de entrega</h2>
            <p className="mt-1 text-sm opacity-70">{selected.length} pedido(s) selecionado(s).</p>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-semibold">Motoboy</span>
              <select className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
                <option value="">Selecione</option>
                {drivers.filter((driver) => driver.active).map((driver) => (
                  <option key={driver.id} value={driver.id}>{driver.name} - {driver.vehicle}</option>
                ))}
              </select>
            </label>
            <ol className="mt-4 max-h-64 space-y-2 overflow-auto">
              {selectedOrders.map((order, index) => (
                <li key={order.id} className="rounded-xl bg-slate-100 p-2 text-sm text-slate-900">
                  {index + 1}. {orderCode(order.orderNumber)} - {order.customer.name}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs opacity-60">A sequencia final sera otimizada automaticamente ao criar a rota.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20" onClick={() => setShowRouteModal(false)}>Voltar</button>
              <button className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={!driverId || saving} onClick={() => void createRoute()}>
                {saving ? "Criando..." : "Criar rota"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDriverForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <form className="w-full max-w-xl rounded-2xl bg-white p-5 text-ink dark:bg-slate-900 dark:text-white" onSubmit={saveDriver}>
            <h2 className="text-xl font-bold">Cadastrar motoboy</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {([
                ["name", "Nome"],
                ["phone", "Telefone"],
                ["whatsapp", "WhatsApp"],
                ["vehicle", "Veiculo"],
                ["licensePlate", "Placa (opcional)"],
                ["password", "Senha do app"]
              ] as const).map(([field, label]) => (
                <label key={field} className="grid gap-1 text-sm">
                  <span className="font-semibold">{label}</span>
                  <input
                    className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
                    required={field !== "licensePlate"}
                    type={field === "password" ? "password" : "text"}
                    minLength={field === "password" ? 6 : undefined}
                    value={driverForm[field]}
                    onChange={(event) => setDriverForm((current) => ({ ...current, [field]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20" onClick={() => setShowDriverForm(false)}>Cancelar</button>
              <button className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-50" disabled={saving}>
                {saving ? "Salvando..." : "Cadastrar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
