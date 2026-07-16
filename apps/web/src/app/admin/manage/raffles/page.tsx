"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../../../../lib/admin-api";

type Raffle = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  prize?: string | null;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED" | "FINISHED";
  startsAt?: string | null;
  endsAt?: string | null;
  totalNumbers: number;
  pricePerNumber: number;
  minimumQuantity: number;
  maximumQuantity: number;
  reservationMinutes: number;
  featuredImageUrl?: string | null;
  _count?: { numbers: number; orders: number; participants: number };
};

type RaffleOrder = {
  id: string;
  raffle: { id: string; title: string; slug: string };
  participant: { name: string; phone: string; email?: string | null };
  status: string;
  paymentStatus: string;
  paymentMethod?: string | null;
  mercadoPagoPaymentId?: string | null;
  total: number;
  reservationExpiresAt?: string | null;
  paidAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  createdAt: string;
  numbers: Array<{ formattedNumber: string; price: number }>;
  lastPayment?: { provider: string; providerPaymentId?: string | null; method?: string | null; status: string; processedAt?: string | null } | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const initialForm = {
  title: "",
  description: "",
  regulation: "",
  prize: "",
  status: "DRAFT",
  startsAt: "",
  endsAt: "",
  numberStart: 0,
  numberEnd: 99,
  numberDigits: 2,
  pricePerNumber: 1,
  minimumQuantity: 1,
  maximumQuantity: 10,
  reservationMinutes: 15,
  featuredImageUrl: "",
  videoUrl: ""
};

export default function AdminRafflesPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [orders, setOrders] = useState<RaffleOrder[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const totalNumbers = useMemo(() => Math.max(0, Number(form.numberEnd) - Number(form.numberStart) + 1), [form.numberEnd, form.numberStart]);

  async function load() {
    setLoading(true);
    try {
      setRaffles(await adminApi<Raffle[]>("/admin/raffles"));
      setOrders(await adminApi<RaffleOrder[]>("/admin/raffles/orders"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar rifas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (totalNumbers <= 0) {
      toast.error("Revise a numeracao da rifa");
      return;
    }
    setSaving(true);
    try {
      await adminApi("/admin/raffles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null
        })
      });
      toast.success("Rifa criada com numeros disponiveis");
      setForm(initialForm);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao criar rifa";
      toast.error(message);
      console.error("Erro ao criar rifa", error);
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: Raffle["status"]) {
    try {
      await adminApi(`/admin/raffles/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      toast.success("Status atualizado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar status");
    }
  }

  const update = (field: keyof typeof initialForm, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const paidOrders = orders.filter((order) => order.paymentStatus === "APPROVED" || order.status === "PAID").length;
  const pendingOrders = orders.filter((order) => ["RESERVED", "PENDING_PAYMENT"].includes(order.status)).length;
  const paidRevenue = orders
    .filter((order) => order.paymentStatus === "APPROVED" || order.status === "PAID")
    .reduce((sum, order) => sum + order.total, 0);
  const pendingRevenue = orders
    .filter((order) => ["RESERVED", "PENDING_PAYMENT"].includes(order.status))
    .reduce((sum, order) => sum + order.total, 0);
  const soldNumbers = orders
    .filter((order) => order.paymentStatus === "APPROVED" || order.status === "PAID")
    .reduce((sum, order) => sum + order.numbers.length, 0);
  const uniqueParticipants = Array.from(
    orders.reduce((map, order) => {
      const key = order.participant.email || order.participant.phone;
      if (!map.has(key)) {
        map.set(key, {
          ...order.participant,
          orders: 0,
          paidOrders: 0,
          totalSpent: 0,
          lastOrderAt: order.createdAt
        });
      }
      const participant = map.get(key)!;
      participant.orders += 1;
      if (order.paymentStatus === "APPROVED" || order.status === "PAID") {
        participant.paidOrders += 1;
        participant.totalSpent += order.total;
      }
      if (new Date(order.createdAt).getTime() > new Date(participant.lastOrderAt).getTime()) {
        participant.lastOrderAt = order.createdAt;
      }
      return map;
    }, new Map<string, { name: string; phone: string; email?: string | null; orders: number; paidOrders: number; totalSpent: number; lastOrderAt: string }>())
  ).map(([, participant]) => participant);
  const raffleUrl = (raffle: Raffle) => {
    if (typeof window === "undefined") return `/rifas/${raffle.slug}`;
    return `${window.location.origin}/rifas/${raffle.slug}`;
  };
  const raffleShareText = (raffle: Raffle) => [
    `🎟️ ${raffle.title}`,
    raffle.prize ? `Prêmio: ${raffle.prize}` : null,
    `Número por ${BRL.format(raffle.pricePerNumber)}`,
    `Escolha seus números aqui: ${raffleUrl(raffle)}`
  ].filter(Boolean).join("\n");
  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      toast.error("Nao foi possivel copiar");
    }
  };
  const openWhatsappShare = (raffle: Raffle) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(raffleShareText(raffle))}`, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Sorteios e campanhas</p>
          <h1 className="font-display text-4xl">Rifas</h1>
          <p className="mt-1 text-sm opacity-70">Modulo proprio para campanhas numeradas, reservas e sorteios.</p>
        </div>
        <Link className="rounded-xl bg-ink px-4 py-2 font-bold text-white" href="/admin">Voltar</Link>
      </div>

      <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {[
          ["Campanhas", "#campanhas"],
          ["Participantes", "#participantes"],
          ["Pagamentos", "#pagamentos"],
          ["Sorteios", "#sorteios"],
          ["Relatorios", "#relatorios"]
        ].map(([label, href]) => (
          <a key={href} href={href} className="whitespace-nowrap rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-bold shadow-sm hover:border-orange-300 dark:border-white/10 dark:bg-slate-900">
            {label}
          </a>
        ))}
      </nav>

      <section id="campanhas" className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <form onSubmit={submit} className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
          <h2 className="text-2xl font-bold">Nova rifa</h2>
          <div className="mt-4 grid gap-3">
            <Field label="Titulo"><input className="input" required value={form.title} onChange={(e) => update("title", e.target.value)} /></Field>
            <Field label="Premio"><input className="input" value={form.prize} onChange={(e) => update("prize", e.target.value)} /></Field>
            <Field label="Descricao"><textarea className="input min-h-24" value={form.description} onChange={(e) => update("description", e.target.value)} /></Field>
            <Field label="Regulamento"><textarea className="input min-h-28" value={form.regulation} onChange={(e) => update("regulation", e.target.value)} /></Field>
            <Field label="Imagem principal"><input className="input" placeholder="https://..." value={form.featuredImageUrl} onChange={(e) => update("featuredImageUrl", e.target.value)} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Inicio"><input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} /></Field>
              <Field label="Encerramento"><input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Numero inicial"><input className="input" type="number" min={0} value={form.numberStart} onChange={(e) => update("numberStart", Number(e.target.value))} /></Field>
              <Field label="Numero final"><input className="input" type="number" min={1} value={form.numberEnd} onChange={(e) => update("numberEnd", Number(e.target.value))} /></Field>
              <Field label="Digitos"><input className="input" type="number" min={1} max={8} value={form.numberDigits} onChange={(e) => update("numberDigits", Number(e.target.value))} /></Field>
            </div>
            <p className="rounded-2xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
              Serao criados <strong>{totalNumbers}</strong> numeros. Exemplo: {String(form.numberStart).padStart(Number(form.numberDigits), "0")}
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Valor por numero"><input className="input" type="number" min={0.01} step="0.01" value={form.pricePerNumber} onChange={(e) => update("pricePerNumber", Number(e.target.value))} /></Field>
              <Field label="Minimo por compra"><input className="input" type="number" min={1} value={form.minimumQuantity} onChange={(e) => update("minimumQuantity", Number(e.target.value))} /></Field>
              <Field label="Maximo por compra"><input className="input" type="number" min={1} value={form.maximumQuantity} onChange={(e) => update("maximumQuantity", Number(e.target.value))} /></Field>
            </div>
            <Field label="Tempo de reserva pendente">
              <div className="grid gap-2">
                <input className="input" type="number" min={5} max={1440} value={form.reservationMinutes} onChange={(e) => update("reservationMinutes", Number(e.target.value))} />
                <span className="rounded-2xl bg-orange-50 px-3 py-2 text-xs text-orange-800">
                  Padrao recomendado: 15 minutos. Se o Pix nao for pago nesse prazo, os numeros voltam para venda.
                </span>
              </div>
            </Field>
            <Field label="Status inicial">
              <select className="input" value={form.status} onChange={(e) => update("status", e.target.value)}>
                <option value="DRAFT">Rascunho</option>
                <option value="SCHEDULED">Agendada</option>
                <option value="ACTIVE">Ativa</option>
                <option value="PAUSED">Pausada</option>
              </select>
            </Field>
          </div>
          <button disabled={saving} className="mt-5 w-full rounded-2xl bg-ember px-4 py-3 font-bold text-white disabled:opacity-60">
            {saving ? "Criando..." : "Criar rifa"}
          </button>
        </form>

        <section className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">Campanhas</h2>
            <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void load()}>Atualizar</button>
          </div>
          <div className="mt-4 space-y-3">
            {loading && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Carregando...</p>}
            {!loading && raffles.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Nenhuma rifa cadastrada.</p>}
            {raffles.map((raffle) => (
              <article key={raffle.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-ember">{raffle.status}</p>
                    <h3 className="text-xl font-bold">{raffle.title}</h3>
                    <p className="text-sm opacity-70">{raffle.prize || "Premio nao informado"}</p>
                    <p className="mt-1 text-xs opacity-60">{raffle.totalNumbers} numeros • {BRL.format(raffle.pricePerNumber)} por numero • reserva {raffle.reservationMinutes ?? 15} min • {raffle._count?.orders ?? 0} pedido(s)</p>
                  </div>
                  <strong className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-700">{raffle._count?.numbers ?? raffle.totalNumbers} nums</strong>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {raffle.status !== "ACTIVE" && <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white" onClick={() => void changeStatus(raffle.id, "ACTIVE")}>Publicar</button>}
                  {raffle.status === "ACTIVE" && <button className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void changeStatus(raffle.id, "PAUSED")}>Pausar</button>}
                  <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void changeStatus(raffle.id, "FINISHED")}>Finalizar</button>
                  <span className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-800">/rifas/{raffle.slug}</span>
                </div>
                <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-orange-700">Divulgacao</p>
                  <p className="mt-1 break-all font-mono text-xs">{raffleUrl(raffle)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="rounded-xl bg-ink px-3 py-2 text-xs font-bold text-white" onClick={() => window.open(raffleUrl(raffle), "_blank", "noopener,noreferrer")}>Abrir vitrine</button>
                    <button type="button" className="rounded-xl border border-orange-300 px-3 py-2 text-xs font-bold" onClick={() => void copyText(raffleUrl(raffle), "Link copiado")}>Copiar link</button>
                    <button type="button" className="rounded-xl border border-orange-300 px-3 py-2 text-xs font-bold" onClick={() => void copyText(raffleShareText(raffle), "Texto de divulgacao copiado")}>Copiar texto</button>
                    <button type="button" className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white" onClick={() => openWhatsappShare(raffle)}>Enviar WhatsApp</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section id="pagamentos" className="mt-6 scroll-mt-24 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Reservas e pagamentos</p>
            <h2 className="text-2xl font-bold">Pedidos das rifas</h2>
            <p className="text-sm opacity-70">{paidOrders} pago(s) · {pendingOrders} pendente(s)</p>
          </div>
          <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void load()}>Atualizar pedidos</button>
        </div>

        <div className="mt-4 grid gap-3">
          {!loading && orders.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Nenhum pedido de rifa ainda.</p>}
          {orders.map((order) => (
            <article key={order.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{order.participant.name}</h3>
                  <p className="text-sm opacity-70">{order.raffle.title} · {new Date(order.createdAt).toLocaleString("pt-BR")}</p>
                  <p className="text-xs opacity-70">
                    {order.participant.phone}{order.participant.email ? ` · ${order.participant.email}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <strong>{BRL.format(order.total)}</strong>
                  <p className={`mt-1 rounded-full px-3 py-1 text-xs font-bold ${order.paymentStatus === "APPROVED" || order.status === "PAID" ? "bg-emerald-100 text-emerald-700" : order.status === "EXPIRED" || order.paymentStatus === "CANCELLED" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                    {order.status} / {order.paymentStatus}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {order.numbers.map((number) => (
                  <span key={number.formattedNumber} className="rounded-lg bg-slate-100 px-2 py-1 text-sm font-bold dark:bg-slate-800">
                    {number.formattedNumber}
                  </span>
                ))}
              </div>
              <div className="mt-3 grid gap-1 text-xs opacity-70 md:grid-cols-2">
                <span>Pagamento MP: {order.mercadoPagoPaymentId || order.lastPayment?.providerPaymentId || "-"}</span>
                <span>{order.paidAt ? `Pago em ${new Date(order.paidAt).toLocaleString("pt-BR")}` : order.reservationExpiresAt ? `Expira em ${new Date(order.reservationExpiresAt).toLocaleString("pt-BR")}` : "Sem expiracao"}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="participantes" className="mt-6 scroll-mt-24 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-purple-700">Participantes</p>
            <h2 className="text-2xl font-bold">Base de compradores</h2>
            <p className="text-sm opacity-70">{uniqueParticipants.length} participante(s) com interesse ou compra registrada.</p>
          </div>
          <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void copyText(
            uniqueParticipants.map((participant) => `${participant.name};${participant.phone};${participant.email || ""};${BRL.format(participant.totalSpent)}`).join("\n"),
            "Lista de participantes copiada"
          )}>Copiar lista</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {!loading && uniqueParticipants.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Nenhum participante ainda.</p>}
          {uniqueParticipants.map((participant) => (
            <article key={participant.email || participant.phone} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
              <h3 className="text-lg font-bold">{participant.name}</h3>
              <p className="text-sm opacity-70">{participant.phone}{participant.email ? ` · ${participant.email}` : ""}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><strong>{participant.orders}</strong><br />pedido(s)</span>
                <span className="rounded-xl bg-emerald-50 p-2 text-emerald-800"><strong>{participant.paidOrders}</strong><br />pago(s)</span>
                <span className="rounded-xl bg-orange-50 p-2 text-orange-800"><strong>{BRL.format(participant.totalSpent)}</strong><br />total</span>
              </div>
              <p className="mt-2 text-xs opacity-60">Ultimo pedido: {new Date(participant.lastOrderAt).toLocaleString("pt-BR")}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="sorteios" className="mt-6 scroll-mt-24 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-purple-700">Sorteios</p>
        <h2 className="text-2xl font-bold">Apuracao e ganhadores</h2>
        <p className="mt-1 text-sm opacity-70">
          Use esta area para acompanhar campanhas finalizadas e preparar a apuracao. Por seguranca, somente numeros pagos entram na contagem.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <MetricCard label="Campanhas finalizadas" value={raffles.filter((raffle) => ["ENDED", "FINISHED"].includes(raffle.status)).length.toString()} />
          <MetricCard label="Numeros pagos" value={soldNumbers.toString()} />
          <MetricCard label="Pedidos pagos" value={paidOrders.toString()} />
        </div>
        <div className="mt-4 rounded-2xl bg-purple-50 p-4 text-sm text-purple-950">
          Proximo passo operacional: selecionar uma campanha finalizada, sortear um numero pago e registrar o ganhador com auditoria.
        </div>
      </section>

      <section id="relatorios" className="mt-6 scroll-mt-24 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Relatorios</p>
        <h2 className="text-2xl font-bold">Resumo comercial</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricCard label="Faturamento pago" value={BRL.format(paidRevenue)} />
          <MetricCard label="Reservas pendentes" value={BRL.format(pendingRevenue)} />
          <MetricCard label="Pedidos" value={orders.length.toString()} />
          <MetricCard label="Conversao" value={`${orders.length ? Math.round((paidOrders / orders.length) * 100) : 0}%`} />
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-800">
      <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
