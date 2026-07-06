"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch, resolveAssetUrl } from "../../../lib/api";
import type { PublicCompany } from "../../../lib/types";

type TicketType = {
  id: string;
  name: string;
  audience?: "GENERAL" | "MEN" | "WOMEN" | "COUPLE" | "STUDENT" | "VIP" | "OTHER";
  description?: string | null;
  price: number;
  quantityTotal: number;
  quantitySold: number;
  lotName?: string | null;
  saleStart?: string | null;
  saleEnd?: string | null;
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
};

type TicketOrder = {
  id: string;
  total: number;
  customerName: string;
  paidAt?: string | null;
  paymentStatus?: string | null;
  mercadoPago?: {
    type: "PIX" | "CHECKOUT";
    paymentId?: string | null;
    status?: string | null;
    statusDetail?: string | null;
    qrCode?: string | null;
    qrCodeBase64?: string | null;
    ticketUrl?: string | null;
    preferenceId?: string | null;
    initPoint?: string | null;
    sandboxInitPoint?: string | null;
  };
  tickets: Array<{
    id: string;
    code: string;
    qrCode: string;
    ticketType: TicketType;
  }>;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const audienceLabel: Record<NonNullable<TicketType["audience"]>, string> = {
  GENERAL: "Geral",
  MEN: "Masculino",
  WOMEN: "Feminino",
  COUPLE: "Casadinha",
  STUDENT: "Estudante / meia",
  VIP: "VIP",
  OTHER: "Outro"
};

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

export function EventsStorefront({ company }: { company: PublicCompany }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [paymentMethod, setPaymentMethod] = useState<"PIX" | "CARD" | "MERCADO_PAGO">("PIX");
  const [lastOrder, setLastOrder] = useState<TicketOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void apiFetch("/events", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Nao foi possivel carregar os eventos");
        setEvents(await response.json());
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar eventos"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const storedOrderId = window.localStorage.getItem(`events:lastOrder:${company.subdomain}`);
    if (!storedOrderId) return;

    let active = true;
    const refresh = async () => {
      try {
        const response = await apiFetch(`/events/orders/${storedOrderId}/mercadopago/status`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setLastOrder((current) => {
          if (!current || current.id !== storedOrderId) {
            return current;
          }
          return {
            ...current,
            paidAt: payload.paidAt ?? current.paidAt,
            paymentStatus: payload.paymentStatus ?? current.paymentStatus
          };
        });
        if (payload.paid) {
          window.localStorage.removeItem(`events:lastOrder:${company.subdomain}`);
        }
      } catch {
        // ignore polling errors while payment is pending
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [company.subdomain]);

  const total = useMemo(() => {
    if (!selectedEvent) return 0;
    return selectedEvent.ticketTypes.reduce((sum, ticketType) => {
      return sum + (quantities[ticketType.id] || 0) * Number(ticketType.price);
    }, 0);
  }, [quantities, selectedEvent]);

  const nextEvent = events[0];
  const themeStyle = {
    background: `radial-gradient(circle at top, ${company.primaryColor}30 0%, transparent 35%), radial-gradient(circle at 85% 15%, ${company.secondaryColor}40 0%, transparent 22%), linear-gradient(180deg, #0b1020 0%, #070b14 100%)`
  } as const;

  async function reserveTickets(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEvent) return;
    const items = selectedEvent.ticketTypes
      .map((ticketType) => ({ ticketTypeId: ticketType.id, quantity: quantities[ticketType.id] || 0 }))
      .filter((item) => item.quantity > 0);
    if (!items.length) {
      toast.error("Selecione pelo menos um ingresso");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`/events/${selectedEvent.id}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          items
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "Falha ao reservar ingresso");
      setLastOrder(payload);
      window.localStorage.setItem(`events:lastOrder:${company.subdomain}`, payload.id);
      setQuantities({});
      if (payload?.mercadoPago?.type === "CHECKOUT" && payload?.mercadoPago?.initPoint) {
        toast.success("Abrindo checkout do Mercado Pago...");
        window.location.href = payload.mercadoPago.initPoint;
        return;
      }
      if (payload?.mercadoPago?.type === "PIX") {
        toast.success("Pagamento Pix gerado. Finalize para confirmar o ingresso.");
      } else {
        toast.success("Reserva criada.");
      }
      setSelectedEvent(null);
      setPaymentMethod("PIX");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reservar ingresso");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen text-white" style={themeStyle}>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-70" style={{ background: `linear-gradient(180deg, ${company.primaryColor}18 0%, transparent 30%)` }} />
        <div className="relative mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-between px-4 py-8">
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl border border-white/20 bg-white text-slate-900 shadow-lg shadow-black/20">
                {company.logoUrl ? (
                  <Image src={resolveAssetUrl(company.logoUrl)} alt={company.tradeName} width={56} height={56} className="h-full w-full object-contain p-1" unoptimized />
                ) : (
                  "HR"
                )}
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.35em] text-orange-200">HubRegional Eventos</p>
                <h1 className="text-2xl font-black">{company.tradeName}</h1>
              </div>
            </div>
            <span className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold backdrop-blur">{company.city}</span>
          </header>

          <div className="grid items-end gap-8 py-12 lg:grid-cols-[1.1fr_.9fr]">
            <div className="space-y-5">
              <p className="w-fit rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold tracking-wide text-white/90 backdrop-blur">Shows, festas e experiencias regionais</p>
              <h2 className="mt-5 max-w-3xl text-5xl font-black leading-tight md:text-7xl">
                Compre ingressos com seguranca no HubRegional.
              </h2>
              <p className="max-w-2xl text-lg text-white/75">
                Escolha o evento, selecione o lote e conclua o pagamento online. O QR Code só aparece depois da confirmação.
              </p>
            </div>
            {nextEvent && (
              <article className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/10 shadow-2xl backdrop-blur">
                {nextEvent.bannerUrl && (
                  <Image src={resolveAssetUrl(nextEvent.bannerUrl)} alt={nextEvent.title} width={800} height={420} className="h-56 w-full rounded-[1.5rem] object-cover" unoptimized />
                )}
                <div className="p-5">
                  <p className="text-sm font-bold uppercase tracking-[0.25em]" style={{ color: company.secondaryColor }}>Proximo evento</p>
                <h3 className="mt-2 text-3xl font-black">{nextEvent.title}</h3>
                <p className="mt-2 text-white/70">{formatDate(nextEvent.eventDate)} as {nextEvent.startTime} • {nextEvent.location}</p>
                <button className="mt-5 w-full rounded-2xl px-5 py-4 font-black text-white transition hover:brightness-110" style={{ background: `linear-gradient(135deg, ${company.primaryColor}, ${company.secondaryColor})` }} onClick={() => setSelectedEvent(nextEvent)}>
                  Ver ingressos
                </button>
                </div>
              </article>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.35em] text-orange-300">Agenda</p>
            <h2 className="text-4xl font-black">Eventos disponiveis</h2>
          </div>
        </div>

        {loading && <p className="mt-8 text-white/60">Carregando eventos...</p>}
        {!loading && events.length === 0 && (
          <div className="mt-8 rounded-3xl border border-white/10 bg-white/10 p-8 text-center backdrop-blur">
            <h3 className="text-2xl font-black">Nenhum evento publicado ainda</h3>
            <p className="mt-2 text-white/60">Quando a empresa publicar eventos, eles aparecem aqui.</p>
          </div>
        )}

        <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {events.map((event) => {
            const minPrice = event.ticketTypes.length ? Math.min(...event.ticketTypes.map((ticket) => Number(ticket.price))) : 0;
            return (
              <article key={event.id} className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/95 text-slate-950 shadow-xl">
                <div className="h-44 bg-slate-200">
                  {event.bannerUrl && (
                    <Image src={resolveAssetUrl(event.bannerUrl)} alt={event.title} width={700} height={360} className="h-full w-full object-cover" unoptimized />
                  )}
                </div>
                <div className="p-5">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-600">{formatDate(event.eventDate)} • {event.startTime}</p>
                  <h3 className="mt-2 text-2xl font-black">{event.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{event.location}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="font-bold">{minPrice > 0 ? `A partir de ${money.format(minPrice)}` : "Ingressos em breve"}</span>
                    <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" onClick={() => setSelectedEvent(event)}>
                      Comprar
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4">
          <form className="mx-auto my-8 max-w-2xl rounded-[2rem] bg-white p-5 text-slate-950 shadow-2xl" onSubmit={reserveTickets}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-600">Ingressos</p>
                <h2 className="text-3xl font-black">{selectedEvent.title}</h2>
                <p className="mt-1 text-sm text-slate-600">{formatDate(selectedEvent.eventDate)} as {selectedEvent.startTime} • {selectedEvent.location}</p>
              </div>
              <button type="button" className="rounded-full bg-slate-100 px-4 py-2 font-bold" onClick={() => setSelectedEvent(null)}>Fechar</button>
            </div>

            <div className="mt-5 space-y-3">
              {selectedEvent.ticketTypes.map((ticketType) => {
                const remaining = ticketType.quantityTotal - ticketType.quantitySold;
                return (
                  <label key={ticketType.id} className="flex items-center justify-between gap-3 rounded-2xl border p-4">
                    <div>
                      <strong>{ticketType.name}</strong>
                      <p className="text-sm text-slate-500">{ticketType.lotName || "Lote unico"} • {audienceLabel[ticketType.audience ?? "GENERAL"]} • {remaining} disponiveis</p>
                      <p className="mt-1 font-black text-orange-600">{money.format(ticketType.price)}</p>
                    </div>
                    <input
                      className="w-24 rounded-xl border px-3 py-2 text-center"
                      type="number"
                      min={0}
                      max={remaining}
                      value={quantities[ticketType.id] || 0}
                      onChange={(event) => setQuantities((value) => ({ ...value, [ticketType.id]: Math.max(0, Number(event.target.value) || 0) }))}
                    />
                  </label>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <input className="rounded-xl border px-3 py-3" placeholder="Nome completo" required value={customer.name} onChange={(event) => setCustomer((value) => ({ ...value, name: event.target.value }))} />
              <input className="rounded-xl border px-3 py-3" placeholder="WhatsApp" required value={customer.phone} onChange={(event) => setCustomer((value) => ({ ...value, phone: event.target.value }))} />
              <input className="rounded-xl border px-3 py-3" placeholder="Email" type="email" required value={customer.email} onChange={(event) => setCustomer((value) => ({ ...value, email: event.target.value }))} />
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-600">Pagamento</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {[
                  ["PIX", "Pix", "Chave copia e cola e QR Code"],
                  ["CARD", "Cartao", "Cartao de credito ou debito"],
                  ["MERCADO_PAGO", "Mercado Pago", "Checkout digital da plataforma"]
                ].map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-2xl border p-4 text-left transition ${paymentMethod === value ? "border-orange-500 bg-orange-100" : "border-slate-200 bg-white"}`}
                    onClick={() => setPaymentMethod(value as typeof paymentMethod)}
                  >
                    <strong className="block">{label}</strong>
                    <span className="mt-1 block text-sm text-slate-600">{description}</span>
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-white p-4 text-sm text-slate-600">
                {paymentMethod === "PIX" && "Ao confirmar, mostramos QR Code e copia e cola para pagamento imediato."}
                {paymentMethod === "CARD" && "Ao confirmar, liberamos o fluxo de cartao para fechamento online."}
                {paymentMethod === "MERCADO_PAGO" && "Checkout Mercado Pago entra aqui com integracao completa na proxima etapa."}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-100 p-4">
              <div>
                <p className="text-sm text-slate-500">Total da reserva</p>
                <strong className="text-3xl">{money.format(total)}</strong>
              </div>
              <button className="rounded-2xl bg-orange-500 px-6 py-4 font-black text-white disabled:opacity-50" disabled={submitting}>
                {submitting ? "Reservando..." : paymentMethod === "MERCADO_PAGO" ? "Continuar no Mercado Pago" : "Reservar ingressos"}
              </button>
            </div>
          </form>
        </div>
      )}

      {lastOrder && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-xl rounded-3xl bg-emerald-500 p-5 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em]">Reserva criada</p>
              <h3 className="mt-1 text-2xl font-black">{money.format(lastOrder.total)}</h3>
              <p className="mt-1 text-sm text-white/85">Os ingressos e QR Code serão liberados somente após a confirmação do pagamento.</p>
            </div>
            <button className="rounded-full bg-white/20 px-3 py-2 font-bold" onClick={() => setLastOrder(null)}>OK</button>
          </div>
        </div>
      )}
    </main>
  );
}
