"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { adminApi, getAdminToken } from "../../../../lib/admin-api";
import { apiFetch, readApiJson, resolveAssetUrl } from "../../../../lib/api";

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
  videoUrl?: string | null;
  videoUrls?: string[];
  drawMode?: "MANUAL" | "AUTOMATIC_CAIXA";
  drawLotteryModality?: string | null;
  drawContestNumber?: string | null;
  drawScheduledAt?: string | null;
  drawStatus?: string | null;
  drawLastAttemptAt?: string | null;
  drawAttemptCount?: number | null;
  drawLastError?: string | null;
  drawBaseNumber?: string | null;
  drawDigits?: number | null;
  drawWinningNumber?: string | null;
  drawOfficialDate?: string | null;
  drawConfirmedAt?: string | null;
  drawWinnerParticipantId?: string | null;
  drawWinnerOrderId?: string | null;
  drawWinnerNumberId?: string | null;
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

function isPaidOrder(order: RaffleOrder) {
  return order.paymentStatus === "APPROVED" || order.status === "PAID";
}

function isPendingOrder(order: RaffleOrder) {
  return ["RESERVED", "PENDING_PAYMENT"].includes(order.status);
}

function pickRandomIndex(length: number) {
  if (length <= 0) return -1;
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

function csvCell(value: string | number | null | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

const drawStatusLabels: Record<string, string> = {
  MANUAL: "Manual",
  SCHEDULED: "Agendado",
  WAITING_CONTEST: "Aguardando identificacao do concurso",
  WAITING_RESULT: "Aguardando resultado",
  PROCESSING: "Processando",
  CONFIRMED: "Resultado confirmado",
  NO_VALID_PARTICIPANT: "Numero sorteado sem participante",
  ERROR: "Erro"
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function canRetryDraw(status?: string | null) {
  return ["SCHEDULED", "WAITING_CONTEST", "WAITING_RESULT", "ERROR"].includes(status ?? "");
}

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
  videoUrl: "",
  videoUrls: [""],
  drawMode: "MANUAL" as "MANUAL" | "AUTOMATIC_CAIXA",
  drawLotteryModality: "federal",
  drawContestNumber: "",
  drawScheduledAt: ""
};

export default function AdminRafflesPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [orders, setOrders] = useState<RaffleOrder[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedDrawRaffleId, setSelectedDrawRaffleId] = useState("");
  const [drawResult, setDrawResult] = useState<{
    raffleId: string;
    raffleTitle: string;
    number: string;
    participantName: string;
    participantPhone: string;
    participantEmail?: string | null;
    orderId: string;
    paidAt?: string | null;
    createdAt: string;
  } | null>(null);

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
      const videoUrls = form.videoUrls.map((url) => url.trim()).filter(Boolean).slice(0, 5);
      const automaticDraw = form.drawMode === "AUTOMATIC_CAIXA";
      await adminApi("/admin/raffles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          videoUrl: videoUrls[0] ?? "",
          videoUrls,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
          drawMode: form.drawMode,
          drawLotteryModality: automaticDraw ? form.drawLotteryModality : null,
          drawContestNumber: automaticDraw && form.drawContestNumber ? form.drawContestNumber : null,
          drawScheduledAt: automaticDraw && form.drawScheduledAt ? new Date(form.drawScheduledAt).toISOString() : null
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

  const update = <K extends keyof typeof initialForm>(field: K, value: (typeof initialForm)[K]) => setForm((current) => ({ ...current, [field]: value }));
  const updateVideoUrl = (index: number, value: string) => {
    setForm((current) => ({
      ...current,
      videoUrls: current.videoUrls.map((url, currentIndex) => currentIndex === index ? value : url)
    }));
  };
  const addVideoUrl = () => {
    setForm((current) => current.videoUrls.length >= 5 ? current : { ...current, videoUrls: [...current.videoUrls, ""] });
  };
  const removeVideoUrl = (index: number) => {
    setForm((current) => ({
      ...current,
      videoUrls: current.videoUrls.length <= 1 ? [""] : current.videoUrls.filter((_, currentIndex) => currentIndex !== index)
    }));
  };
  const uploadRaffleImage = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Envie uma imagem valida para a rifa");
      return;
    }
    const token = getAdminToken();
    if (!token) {
      toast.error("Sessao expirada. Entre novamente no painel.");
      return;
    }
    setUploadingImage(true);
    try {
      const data = new FormData();
      data.append("image", file);
      const response = await apiFetch("/admin/uploads/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data
      }, { json: false, skipSubdomain: true });
      const payload = await readApiJson<{ url?: string; message?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? "Falha ao enviar imagem");
      if (!payload.url) throw new Error("Upload sem URL de retorno");
      update("featuredImageUrl", payload.url);
      toast.success("Imagem da rifa enviada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    } finally {
      setUploadingImage(false);
    }
  };
  const paidOrders = orders.filter(isPaidOrder).length;
  const pendingOrders = orders.filter(isPendingOrder).length;
  const paidRevenue = orders
    .filter(isPaidOrder)
    .reduce((sum, order) => sum + order.total, 0);
  const pendingRevenue = orders
    .filter(isPendingOrder)
    .reduce((sum, order) => sum + order.total, 0);
  const soldNumbers = orders
    .filter(isPaidOrder)
    .reduce((sum, order) => sum + order.numbers.length, 0);
  const drawEntries = orders
    .filter(isPaidOrder)
    .flatMap((order) => order.numbers.map((number) => ({
      raffleId: order.raffle.id,
      raffleTitle: order.raffle.title,
      number: number.formattedNumber,
      participantName: order.participant.name,
      participantPhone: order.participant.phone,
      participantEmail: order.participant.email,
      orderId: order.id,
      paidAt: order.paidAt,
      createdAt: order.createdAt
    })));
  const selectedDrawEntries = selectedDrawRaffleId
    ? drawEntries.filter((entry) => entry.raffleId === selectedDrawRaffleId)
    : drawEntries;
  const raffleReports = raffles.map((raffle) => {
    const raffleOrders = orders.filter((order) => order.raffle.id === raffle.id);
    const rafflePaidOrders = raffleOrders.filter(isPaidOrder);
    const rafflePendingOrders = raffleOrders.filter(isPendingOrder);
    const participantKeys = new Set(raffleOrders.map((order) => order.participant.email || order.participant.phone));
    return {
      id: raffle.id,
      title: raffle.title,
      status: raffle.status,
      totalOrders: raffleOrders.length,
      paidOrders: rafflePaidOrders.length,
      pendingOrders: rafflePendingOrders.length,
      paidRevenue: rafflePaidOrders.reduce((sum, order) => sum + order.total, 0),
      pendingRevenue: rafflePendingOrders.reduce((sum, order) => sum + order.total, 0),
      soldNumbers: rafflePaidOrders.reduce((sum, order) => sum + order.numbers.length, 0),
      participants: participantKeys.size
    };
  });
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
      if (isPaidOrder(order)) {
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
  const retryAutomaticDraw = async (raffle: Raffle) => {
    try {
      const result = await adminApi<{ status?: string; message?: string }>(`/admin/raffles/${raffle.id}/draw/retry`, { method: "POST" });
      toast.success(result.message ?? "Apuracao consultada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao tentar apuracao");
    }
  };
  const runDraw = () => {
    if (!selectedDrawEntries.length) {
      toast.error("Nenhum numero pago disponivel para sorteio nesta selecao.");
      return;
    }
    const winner = selectedDrawEntries[pickRandomIndex(selectedDrawEntries.length)];
    setDrawResult(winner);
    toast.success(`Numero sorteado: ${winner.number}`);
  };
  const drawText = drawResult ? [
    `Resultado do sorteio - ${drawResult.raffleTitle}`,
    `Numero sorteado: ${drawResult.number}`,
    `Ganhador: ${drawResult.participantName}`,
    `Telefone: ${drawResult.participantPhone}`,
    drawResult.participantEmail ? `Email: ${drawResult.participantEmail}` : null,
    `Pedido: ${drawResult.orderId}`,
    `Data: ${new Date().toLocaleString("pt-BR")}`
  ].filter(Boolean).join("\n") : "";
  const openWinnerWhatsapp = () => {
    if (!drawResult) return;
    const phone = drawResult.participantPhone.replace(/\D/g, "");
    const whatsappPhone = phone.startsWith("55") ? phone : `55${phone}`;
    window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(drawText)}`, "_blank", "noopener,noreferrer");
  };
  const exportReportsCsv = () => {
    const header = ["Rifa", "Status", "Pedidos", "Pagos", "Pendentes", "Numeros pagos", "Participantes", "Faturamento pago", "Reservas pendentes"];
    const rows = raffleReports.map((report) => [
      report.title,
      report.status,
      report.totalOrders,
      report.paidOrders,
      report.pendingOrders,
      report.soldNumbers,
      report.participants,
      report.paidRevenue.toFixed(2),
      report.pendingRevenue.toFixed(2)
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio-rifas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const copyReports = () => {
    const text = raffleReports.map((report) => (
      `${report.title}: ${report.paidOrders} pago(s), ${report.pendingOrders} pendente(s), ${report.soldNumbers} numero(s), ${BRL.format(report.paidRevenue)} faturado`
    )).join("\n");
    void copyText(text || "Nenhum relatorio disponivel", "Relatorio copiado");
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
          ["Relatorios", "#relatorios"],
          ["Integracoes", "#integracoes"]
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
            <Field label="Imagem principal">
              <div className="grid gap-2 rounded-2xl border border-black/10 p-3 dark:border-white/10">
                <input className="input" placeholder="URL da imagem ou envie um arquivo abaixo" value={form.featuredImageUrl} onChange={(e) => update("featuredImageUrl", e.target.value)} />
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage}
                  onChange={(event) => void uploadRaffleImage(event.target.files?.[0])}
                />
                {uploadingImage && <span className="text-xs font-bold text-orange-700">Enviando imagem...</span>}
                {form.featuredImageUrl && (
                  <img
                    src={resolveAssetUrl(form.featuredImageUrl)}
                    alt="Previa da rifa"
                    className="h-32 w-full rounded-2xl object-cover"
                  />
                )}
              </div>
            </Field>
            <Field label="Videos da rifa (ate 5)">
              <div className="grid gap-2 rounded-2xl border border-black/10 p-3 dark:border-white/10">
                {form.videoUrls.map((url, index) => (
                  <div key={index} className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      className="input"
                      placeholder={`Link do video ${index + 1}`}
                      value={url}
                      onChange={(event) => updateVideoUrl(index, event.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-600 disabled:opacity-40"
                      disabled={form.videoUrls.length <= 1}
                      onClick={() => removeVideoUrl(index)}
                    >
                      Remover
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs opacity-70">Use links do YouTube, Instagram, TikTok ou videos hospedados. Limite: 5.</span>
                  <button type="button" className="rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={form.videoUrls.length >= 5} onClick={addVideoUrl}>
                    + Adicionar video
                  </button>
                </div>
              </div>
            </Field>
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
            <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
              <label className="flex items-start gap-3 font-bold">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={form.drawMode === "AUTOMATIC_CAIXA"}
                  onChange={(event) => update("drawMode", event.target.checked ? "AUTOMATIC_CAIXA" : "MANUAL")}
                />
                <span>Usar resultado automatico das Loterias CAIXA</span>
              </label>
              <p className="mt-2 opacity-80">
                Desativado: o sorteio manual continua igual. Ativado: o sistema consulta a CAIXA depois do horario programado.
              </p>
              {form.drawMode === "AUTOMATIC_CAIXA" && (
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <Field label="Modalidade">
                    <select className="input" value={form.drawLotteryModality} onChange={(event) => update("drawLotteryModality", event.target.value)}>
                      <option value="federal">Loteria Federal</option>
                    </select>
                    <p className="mt-1 text-xs opacity-70">Outras modalidades precisam de regra propria de apuracao e ficam bloqueadas por seguranca.</p>
                  </Field>
                  <Field label="Concurso (opcional)">
                    <input className="input" value={form.drawContestNumber} onChange={(event) => update("drawContestNumber", event.target.value.replace(/\D/g, ""))} placeholder="Ex: 5963" />
                  </Field>
                  <Field label="Data/hora prevista">
                    <input className="input" type="datetime-local" required value={form.drawScheduledAt} onChange={(event) => update("drawScheduledAt", event.target.value)} />
                  </Field>
                </div>
              )}
            </div>
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
                {raffle.drawMode === "AUTOMATIC_CAIXA" && (
                  <div className="mt-3 rounded-2xl border border-purple-200 bg-purple-50 p-3 text-sm text-purple-950">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black uppercase tracking-[0.25em]">Apuracao CAIXA</p>
                        <p className="mt-1 font-bold">{drawStatusLabels[raffle.drawStatus ?? ""] ?? raffle.drawStatus ?? "Automatico"}</p>
                      </div>
                      {canRetryDraw(raffle.drawStatus) && (
                        <button type="button" onClick={() => void retryAutomaticDraw(raffle)} className="rounded-xl bg-purple-700 px-3 py-2 text-xs font-bold text-white">
                          Tentar novamente
                        </button>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-3">
                      <p><span className="font-bold">Modalidade:</span> {raffle.drawLotteryModality === "federal" ? "Loteria Federal" : raffle.drawLotteryModality ?? "-"}</p>
                      <p><span className="font-bold">Concurso:</span> {raffle.drawContestNumber ?? "A identificar"}</p>
                      <p><span className="font-bold">Previsto:</span> {formatDateTime(raffle.drawScheduledAt)}</p>
                      <p><span className="font-bold">Tentativas:</span> {raffle.drawAttemptCount ?? 0}</p>
                      <p><span className="font-bold">Ultima tentativa:</span> {formatDateTime(raffle.drawLastAttemptAt)}</p>
                      <p><span className="font-bold">Confirmado:</span> {formatDateTime(raffle.drawConfirmedAt)}</p>
                    </div>
                    {raffle.drawWinningNumber && (
                      <p className="mt-2 rounded-xl bg-white/70 p-2 font-bold">
                        Numero ganhador: {raffle.drawWinningNumber} {raffle.drawBaseNumber ? `(base CAIXA ${raffle.drawBaseNumber})` : ""}
                      </p>
                    )}
                    {raffle.drawLastError && <p className="mt-2 rounded-xl bg-red-50 p-2 text-red-700">Ultimo erro: {raffle.drawLastError}</p>}
                  </div>
                )}
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-purple-700">Sorteios</p>
            <h2 className="text-2xl font-bold">Apuracao e ganhadores</h2>
            <p className="mt-1 text-sm opacity-70">
              Sorteie apenas entre numeros pagos. Reservas pendentes, expiradas ou canceladas ficam fora da apuracao.
            </p>
          </div>
          <button type="button" onClick={runDraw} className="rounded-2xl bg-purple-700 px-5 py-3 text-sm font-bold text-white shadow-sm">
            Sortear numero pago
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricCard label="Campanhas finalizadas" value={raffles.filter((raffle) => ["ENDED", "FINISHED"].includes(raffle.status)).length.toString()} />
          <MetricCard label="Numeros elegiveis" value={selectedDrawEntries.length.toString()} />
          <MetricCard label="Pedidos pagos" value={paidOrders.toString()} />
          <MetricCard label="Total arrecadado" value={BRL.format(paidRevenue)} />
        </div>
        <div className="mt-4 grid gap-3 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950 md:grid-cols-[1fr_auto]">
          <label className="grid gap-1">
            <span className="font-bold">Campanha para sortear</span>
            <select
              className="rounded-xl border border-purple-200 bg-white px-3 py-3 text-slate-950"
              value={selectedDrawRaffleId}
              onChange={(event) => {
                setSelectedDrawRaffleId(event.target.value);
                setDrawResult(null);
              }}
            >
              <option value="">Todas as rifas com numeros pagos</option>
              {raffles.map((raffle) => (
                <option key={raffle.id} value={raffle.id}>{raffle.title}</option>
              ))}
            </select>
          </label>
          <div className="rounded-2xl bg-white/70 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">Regra</p>
            <p className="mt-1 font-semibold">Somente numeros pagos entram no sorteio.</p>
          </div>
        </div>
        {drawResult ? (
          <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
            <p className="text-xs font-bold uppercase tracking-[0.35em]">Ganhador sorteado</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <div>
                <h3 className="text-3xl font-black">Numero {drawResult.number}</h3>
                <p className="mt-1 text-lg font-bold">{drawResult.participantName}</p>
                <p className="text-sm opacity-80">{drawResult.participantPhone}{drawResult.participantEmail ? ` - ${drawResult.participantEmail}` : ""}</p>
                <p className="mt-2 text-xs opacity-70">Rifa: {drawResult.raffleTitle} - Pedido: {drawResult.orderId}</p>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <button type="button" className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold" onClick={() => void copyText(drawText, "Resultado copiado")}>
                  Copiar resultado
                </button>
                <button type="button" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={openWinnerWhatsapp}>
                  Avisar no WhatsApp
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm opacity-70 dark:bg-slate-800">
            Selecione a campanha e clique em <strong>Sortear numero pago</strong>. O resultado aparece aqui para copiar ou avisar o ganhador.
          </div>
        )}
      </section>

      <section id="relatorios" className="mt-6 scroll-mt-24 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Relatorios</p>
            <h2 className="text-2xl font-bold">Resumo comercial</h2>
            <p className="mt-1 text-sm opacity-70">Acompanhe faturamento, reservas, conversao e numeros vendidos por campanha.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={copyReports}>Copiar resumo</button>
            <button type="button" className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white" onClick={exportReportsCsv}>Exportar CSV</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricCard label="Faturamento pago" value={BRL.format(paidRevenue)} />
          <MetricCard label="Reservas pendentes" value={BRL.format(pendingRevenue)} />
          <MetricCard label="Pedidos" value={orders.length.toString()} />
          <MetricCard label="Conversao" value={`${orders.length ? Math.round((paidOrders / orders.length) * 100) : 0}%`} />
        </div>
        <div className="mt-4 grid gap-3">
          {raffleReports.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70 dark:bg-slate-800">Nenhuma campanha para relatorio.</p>
          )}
          {raffleReports.map((report) => (
            <article key={report.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{report.title}</h3>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">{report.status}</p>
                </div>
                <strong className="text-emerald-700">{BRL.format(report.paidRevenue)}</strong>
              </div>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-6">
                <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><strong>{report.totalOrders}</strong><br />pedido(s)</span>
                <span className="rounded-xl bg-emerald-50 p-2 text-emerald-800"><strong>{report.paidOrders}</strong><br />pago(s)</span>
                <span className="rounded-xl bg-orange-50 p-2 text-orange-800"><strong>{report.pendingOrders}</strong><br />pendente(s)</span>
                <span className="rounded-xl bg-purple-50 p-2 text-purple-800"><strong>{report.soldNumbers}</strong><br />numero(s)</span>
                <span className="rounded-xl bg-blue-50 p-2 text-blue-800"><strong>{report.participants}</strong><br />participante(s)</span>
                <span className="rounded-xl bg-slate-50 p-2 dark:bg-slate-800"><strong>{BRL.format(report.pendingRevenue)}</strong><br />reservado</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="integracoes" className="mt-6 scroll-mt-24 rounded-3xl border border-purple-200 bg-white/90 p-5 shadow-sm dark:border-purple-500/30 dark:bg-slate-900/70">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-purple-700">Integracoes</p>
        <h2 className="text-2xl font-bold">Integracoes das rifas</h2>
        <p className="mt-1 text-sm opacity-70">
          Esta area mostra apenas conexoes usadas em campanhas de rifas. Configuracoes de delivery, cardapio, mesas e impressao nao fazem parte deste painel.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <IntegrationCard
            title="Mercado Pago"
            description="Receber Pix, confirmar pagamentos automaticamente e liberar numeros pagos."
            status="Pagamento online"
          />
          <IntegrationCard
            title="WhatsApp / MenuIA"
            description="Enviar avisos de reserva, Pix pendente, pagamento aprovado, lembretes e resultado do sorteio."
            status="Mensagens"
          />
          <IntegrationCard
            title="E-mail"
            description="Enviar comprovantes, recibos e comunicados para participantes cadastrados."
            status="Comunicacao"
          />
        </div>

        <div className="mt-4 rounded-2xl bg-purple-50 p-4 text-sm text-purple-950">
          Proximo passo: transformar estes cards em formularios proprios de integracao para rifas, sem misturar com configuracoes de lanchonete.
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

function IntegrationCard({ title, description, status }: { title: string; description: string; status: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-800">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-purple-700">{status}</p>
      <h3 className="mt-2 text-lg font-black">{title}</h3>
      <p className="mt-2 text-sm opacity-70">{description}</p>
    </div>
  );
}
