"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";

type TicketType = {
  id: string;
  name: string;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  lotName?: string | null;
  active: boolean;
};

type EventItem = {
  id: string;
  title: string;
  description?: string | null;
  bannerUrl?: string | null;
  location: string;
  eventDate: string;
  startTime: string;
  endTime?: string | null;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED" | "FINISHED";
  ticketTypes: TicketType[];
  _count?: { ticketOrders: number };
};

type TicketOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  total: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  event: { title: string; eventDate: string };
  tickets: Array<{ id: string; code: string; status: string; ticketType: TicketType }>;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function token() {
  return typeof window === "undefined" ? "" : localStorage.getItem("delivery:token") || "";
}

async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? "Erro na API");
  return payload;
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    bannerUrl: "",
    location: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    status: "DRAFT"
  });
  const [ticketForm, setTicketForm] = useState({
    name: "Pista",
    lotName: "1º lote",
    price: "0",
    quantityTotal: "100",
    description: "",
    active: true
  });
  const [validateCode, setValidateCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [eventList, orderList] = await Promise.all([
        adminRequest<EventItem[]>("/admin/events"),
        adminRequest<TicketOrder[]>("/admin/ticket-orders")
      ]);
      setEvents(eventList);
      setOrders(orderList);
      if (selected) {
        const refreshed = eventList.find((item) => item.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar eventos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createEvent(event: React.FormEvent) {
    event.preventDefault();
    try {
      await adminRequest("/admin/events", {
        method: "POST",
        body: JSON.stringify(eventForm)
      });
      setEventForm({ title: "", description: "", bannerUrl: "", location: "", eventDate: "", startTime: "", endTime: "", status: "DRAFT" });
      toast.success("Evento criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar evento");
    }
  }

  async function updateEventStatus(item: EventItem, status: EventItem["status"]) {
    try {
      await adminRequest(`/admin/events/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      toast.success(status === "PUBLISHED" ? "Evento publicado" : "Status atualizado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar evento");
    }
  }

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      await adminRequest(`/admin/events/${selected.id}/ticket-types`, {
        method: "POST",
        body: JSON.stringify({
          ...ticketForm,
          price: Number(ticketForm.price),
          quantityTotal: Number(ticketForm.quantityTotal)
        })
      });
      setTicketForm({ name: "Pista", lotName: "1º lote", price: "0", quantityTotal: "100", description: "", active: true });
      toast.success("Lote criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar lote");
    }
  }

  async function validateTicket() {
    if (!validateCode.trim()) return;
    try {
      const result = await adminRequest<any>("/admin/tickets/validate", {
        method: "POST",
        body: JSON.stringify({ code: validateCode.trim() })
      });
      toast.success(`Ingresso validado: ${result.ticketOrder.customerName}`);
      setValidateCode("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ingresso invalido");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.35em] text-orange-600">Shows e eventos</p>
          <h1 className="font-display text-4xl">Eventos</h1>
          <p className="text-sm text-slate-500">Crie eventos, lotes de ingressos, acompanhe reservas e valide QR Code.</p>
        </div>
        <a className="rounded-xl bg-ink px-4 py-2 text-white" href="/admin">Voltar</a>
      </div>

      <section className="mt-6 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <form className="rounded-3xl border bg-white p-5 shadow-sm" onSubmit={createEvent}>
          <h2 className="text-xl font-black">Novo evento</h2>
          <div className="mt-4 grid gap-3">
            <input className="input" placeholder="Nome do evento" required value={eventForm.title} onChange={(event) => setEventForm((value) => ({ ...value, title: event.target.value }))} />
            <input className="input" placeholder="Local" required value={eventForm.location} onChange={(event) => setEventForm((value) => ({ ...value, location: event.target.value }))} />
            <input className="input" placeholder="URL do banner/capa" value={eventForm.bannerUrl} onChange={(event) => setEventForm((value) => ({ ...value, bannerUrl: event.target.value }))} />
            <textarea className="input min-h-24" placeholder="Descricao" value={eventForm.description} onChange={(event) => setEventForm((value) => ({ ...value, description: event.target.value }))} />
            <div className="grid gap-3 md:grid-cols-3">
              <input className="input" type="date" required value={eventForm.eventDate} onChange={(event) => setEventForm((value) => ({ ...value, eventDate: event.target.value }))} />
              <input className="input" type="time" required value={eventForm.startTime} onChange={(event) => setEventForm((value) => ({ ...value, startTime: event.target.value }))} />
              <input className="input" type="time" value={eventForm.endTime} onChange={(event) => setEventForm((value) => ({ ...value, endTime: event.target.value }))} />
            </div>
            <select className="input" value={eventForm.status} onChange={(event) => setEventForm((value) => ({ ...value, status: event.target.value }))}>
              <option value="DRAFT">Rascunho</option>
              <option value="PUBLISHED">Publicado</option>
            </select>
            <button className="rounded-2xl bg-orange-600 px-4 py-3 font-black text-white">Criar evento</button>
          </div>
        </form>

        <section className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black">Eventos cadastrados</h2>
            <button className="rounded-xl border px-3 py-2 text-sm" onClick={() => void load()} disabled={loading}>Atualizar</button>
          </div>
          <div className="mt-4 space-y-3">
            {events.map((item) => (
              <article key={item.id} className={`rounded-2xl border p-4 ${selected?.id === item.id ? "border-orange-500 bg-orange-50" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black">{item.title}</h3>
                    <p className="text-sm text-slate-500">{new Date(item.eventDate).toLocaleDateString("pt-BR")} • {item.startTime} • {item.location}</p>
                    <p className="text-xs font-bold uppercase text-slate-400">{item.status} • {item.ticketTypes.length} lote(s) • {item._count?.ticketOrders ?? 0} pedido(s)</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-xl bg-ink px-3 py-2 text-sm text-white" onClick={() => setSelected(item)}>Gerenciar</button>
                    {item.status !== "PUBLISHED" && <button className="rounded-xl bg-emerald-600 px-3 py-2 text-sm text-white" onClick={() => void updateEventStatus(item, "PUBLISHED")}>Publicar</button>}
                    {item.status === "PUBLISHED" && <button className="rounded-xl bg-slate-200 px-3 py-2 text-sm" onClick={() => void updateEventStatus(item, "DRAFT")}>Despublicar</button>}
                  </div>
                </div>
              </article>
            ))}
            {!events.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum evento cadastrado.</p>}
          </div>
        </section>
      </section>

      {selected && (
        <section className="mt-6 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <form className="rounded-3xl border bg-white p-5 shadow-sm" onSubmit={createTicket}>
            <h2 className="text-xl font-black">Lotes / ingressos</h2>
            <p className="text-sm text-slate-500">{selected.title}</p>
            <div className="mt-4 grid gap-3">
              <input className="input" placeholder="Tipo: Pista, VIP, Camarote..." required value={ticketForm.name} onChange={(event) => setTicketForm((value) => ({ ...value, name: event.target.value }))} />
              <input className="input" placeholder="Lote: 1º lote, promocional..." value={ticketForm.lotName} onChange={(event) => setTicketForm((value) => ({ ...value, lotName: event.target.value }))} />
              <textarea className="input" placeholder="Descricao opcional" value={ticketForm.description} onChange={(event) => setTicketForm((value) => ({ ...value, description: event.target.value }))} />
              <div className="grid gap-3 md:grid-cols-2">
                <input className="input" type="number" step="0.01" min="0" placeholder="Preco" required value={ticketForm.price} onChange={(event) => setTicketForm((value) => ({ ...value, price: event.target.value }))} />
                <input className="input" type="number" min="1" placeholder="Quantidade" required value={ticketForm.quantityTotal} onChange={(event) => setTicketForm((value) => ({ ...value, quantityTotal: event.target.value }))} />
              </div>
              <button className="rounded-2xl bg-orange-600 px-4 py-3 font-black text-white">Adicionar lote</button>
            </div>
          </form>

          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-xl font-black">Lotes ativos</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {selected.ticketTypes.map((ticket) => (
                <article key={ticket.id} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <strong>{ticket.name}</strong>
                      <p className="text-xs text-slate-500">{ticket.lotName || "Lote unico"}</p>
                    </div>
                    <strong>{money.format(ticket.price)}</strong>
                  </div>
                  <p className="mt-3 text-sm">Vendidos/reservados: {ticket.quantitySold} de {ticket.quantityTotal}</p>
                </article>
              ))}
              {!selected.ticketTypes.length && <p className="text-sm text-slate-500">Nenhum lote criado ainda.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-5 lg:grid-cols-[.7fr_1.3fr]">
        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Validar ingresso</h2>
          <p className="text-sm text-slate-500">Digite ou cole o codigo/QR Code apresentado na entrada.</p>
          <div className="mt-4 flex gap-2">
            <input className="input" placeholder="Codigo do ingresso" value={validateCode} onChange={(event) => setValidateCode(event.target.value)} />
            <button className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white" onClick={() => void validateTicket()}>Validar</button>
          </div>
        </div>

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Pedidos de ingressos</h2>
          <div className="mt-4 space-y-3">
            {orders.slice(0, 12).map((order) => (
              <article key={order.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{order.customerName}</strong>
                    <p className="text-sm text-slate-500">{order.event.title} • {new Date(order.createdAt).toLocaleString("pt-BR")}</p>
                    <p className="text-xs text-slate-400">{order.tickets.length} ingresso(s): {order.tickets.map((ticket) => ticket.code).join(", ")}</p>
                  </div>
                  <div className="text-right">
                    <strong>{money.format(order.total)}</strong>
                    <p className="text-xs font-bold uppercase text-orange-600">{order.status} / {order.paymentStatus}</p>
                  </div>
                </div>
              </article>
            ))}
            {!orders.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum pedido de ingresso ainda.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
