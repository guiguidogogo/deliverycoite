"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, resolveAssetUrl } from "../lib/api";
import type { PublicCompany } from "../lib/types";

type Raffle = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  prize?: string | null;
  featuredImageUrl?: string | null;
  videoUrl?: string | null;
  videoUrls?: string[];
  pricePerNumber: number;
  reservationMinutes?: number;
  totalNumbers: number;
  paidNumbers: number;
  reservedNumbers: number;
  availableNumbers: number;
  progressPercent: number;
  endsAt?: string | null;
};

type RaffleNumber = {
  id: string;
  formattedNumber: string;
  status: "AVAILABLE" | "RESERVED" | "PENDING_PAYMENT" | "PAID" | "BLOCKED" | "CANCELLED";
};

type ReserveResponse = {
  id: string;
  status: string;
  paymentStatus: string;
  total: number;
  reservationExpiresAt: string;
  token?: string | null;
  numbers: Array<{ formattedNumber: string }>;
};

type RafflePixPayment = {
  orderId: string;
  paymentId?: string;
  status?: string;
  qrCode?: string | null;
  qrCodeBase64?: string | null;
  ticketUrl?: string | null;
  reservationExpiresAt?: string | null;
  paid?: boolean;
};

type RaffleAccountSummary = {
  participant: {
    id?: string;
    name: string;
    phone: string;
    email?: string | null;
  };
};

type RaffleLoginResponse = {
  token: string;
  participant: RaffleAccountSummary["participant"];
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const RAFFLE_TOKEN_KEY = "hubregional:raffleParticipantToken";

function isDirectVideoUrl(url: string) {
  return /\.(mp4|webm|ogg)(\?|#|$)/i.test(url);
}

async function publicRaffleJson<T>(path: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`/api${path}${separator}_=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      try {
        const payload = JSON.parse(text) as { message?: string };
        throw new Error(payload.message ?? `Erro na requisicao ${path}`);
      } catch (error) {
        if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
      }
    }
    throw new Error(`Erro na requisicao ${path}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().replace(/\s+/g, " ").slice(0, 80);
    throw new Error(`Resposta invalida da API em ${path}${preview ? `: ${preview}` : ""}`);
  }
}

export function RaffleStorefront({ company, initialSlug }: { company: PublicCompany; initialSlug?: string }) {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [selected, setSelected] = useState<Raffle | null>(null);
  const [numbers, setNumbers] = useState<RaffleNumber[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([]);
  const [participantName, setParticipantName] = useState("");
  const [participantPhone, setParticipantPhone] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantPassword, setParticipantPassword] = useState("");
  const [pixPayment, setPixPayment] = useState<RafflePixPayment | null>(null);
  const [reserving, setReserving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [loggedParticipant, setLoggedParticipant] = useState<RaffleAccountSummary["participant"] | null>(null);
  const [accountRequiredMessage, setAccountRequiredMessage] = useState("");
  const [inlineLogin, setInlineLogin] = useState("");
  const [inlinePassword, setInlinePassword] = useState("");
  const [inlineLoginLoading, setInlineLoginLoading] = useState(false);
  const notifiedPaidOrders = useRef<Set<string>>(new Set());
  const accountLoginRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = async () => {
      if (initialSlug) {
        try {
          const directRaffle = await publicRaffleJson<Raffle>(`/public/raffles/${initialSlug}`);
          setSelected(directRaffle);
        } catch {
          toast.error("Rifa nao encontrada ou indisponivel");
        }
      }

      const payload = await publicRaffleJson<Raffle[]>("/public/raffles");
      setRaffles(payload);
      if (!initialSlug && payload[0]) {
        setSelected(payload[0]);
      }
    };

    load()
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Falha ao carregar rifas";
        toast.error(message);
      })
      .finally(() => setLoading(false));
  }, [initialSlug]);

  useEffect(() => {
    const token = localStorage.getItem(RAFFLE_TOKEN_KEY);
    if (!token) return;
    api<RaffleAccountSummary>("/public/raffles/account/me", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((payload) => {
        setLoggedParticipant(payload.participant);
        setParticipantName(payload.participant.name ?? "");
        setParticipantPhone(payload.participant.phone ?? "");
        setParticipantEmail(payload.participant.email ?? "");
      })
      .catch(() => {
        localStorage.removeItem(RAFFLE_TOKEN_KEY);
        setLoggedParticipant(null);
      });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setSelectedNumbers([]);
    setPixPayment(null);
    setNumbers([]);
    setNumbersLoading(true);
    publicRaffleJson<RaffleNumber[]>(`/public/raffles/${selected.id}/numbers`)
      .then(setNumbers)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar numeros"))
      .finally(() => setNumbersLoading(false));
  }, [selected]);

  useEffect(() => {
    if (!pixPayment?.orderId || pixPayment.paid) return;
    const interval = window.setInterval(() => {
      api<{ paid: boolean; paymentStatus: string; status: string }>(`/public/raffles/orders/${pixPayment.orderId}/mercadopago/status`)
        .then((status) => {
          setPixPayment((current) => current?.orderId === pixPayment.orderId
            ? { ...current, paid: status.paid, status: status.paymentStatus }
            : current);
          if (status.paid && !notifiedPaidOrders.current.has(pixPayment.orderId)) {
            notifiedPaidOrders.current.add(pixPayment.orderId);
            toast.success("Pagamento confirmado! Seus numeros foram marcados como pagos.");
            if (selected) {
              void publicRaffleJson<RaffleNumber[]>(`/public/raffles/${selected.id}/numbers`).then(setNumbers);
            }
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [pixPayment?.orderId, pixPayment?.paid, selected?.id]);

  const total = useMemo(() => selectedNumbers.length * (selected?.pricePerNumber ?? 0), [selectedNumbers, selected]);
  const selectedVideoUrls = useMemo(() => {
    if (!selected) return [];
    const urls = selected.videoUrls?.filter(Boolean) ?? [];
    return urls.length ? urls.slice(0, 5) : selected.videoUrl ? [selected.videoUrl] : [];
  }, [selected]);

  function toggleNumber(number: RaffleNumber) {
    if (number.status !== "AVAILABLE") return;
    setSelectedNumbers((current) =>
      current.includes(number.id) ? current.filter((id) => id !== number.id) : [...current, number.id]
    );
  }

  function raffleUrl(raffle: Raffle) {
    if (typeof window === "undefined") return `/rifas/${raffle.slug}`;
    return `${window.location.origin}/rifas/${raffle.slug}`;
  }

  async function copyRaffleUrl(raffle: Raffle) {
    const url = raffleUrl(raffle);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link da rifa copiado");
    } catch {
      toast.info(url);
    }
  }

  function applyParticipantLogin(payload: RaffleLoginResponse) {
    localStorage.setItem(RAFFLE_TOKEN_KEY, payload.token);
    setLoggedParticipant(payload.participant);
    setParticipantName(payload.participant.name ?? "");
    setParticipantPhone(payload.participant.phone ?? "");
    setParticipantEmail(payload.participant.email ?? "");
    setParticipantPassword("");
    setAccountRequiredMessage("");
  }

  async function submitInlineLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inlineLogin.trim() || !inlinePassword.trim()) {
      toast.error("Informe e-mail/WhatsApp e senha para entrar");
      return;
    }

    setInlineLoginLoading(true);
    try {
      const payload = await api<RaffleLoginResponse>("/public/raffles/auth/login", {
        method: "POST",
        body: JSON.stringify({
          login: inlineLogin,
          password: inlinePassword
        })
      });
      applyParticipantLogin(payload);
      setInlinePassword("");
      toast.success("Conta acessada. Agora voce pode confirmar a reserva sem perder os numeros escolhidos.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel entrar na conta");
    } finally {
      setInlineLoginLoading(false);
    }
  }

  function openInlineLogin(message?: string) {
    setAccountRequiredMessage(message || "Entre com sua conta para continuar a reserva sem perder os numeros selecionados.");
    setInlineLogin(participantEmail || participantPhone || inlineLogin);
    window.setTimeout(() => accountLoginRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  function isAccountAlreadyRegisteredMessage(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("cadastro com este e-mail") ||
      normalized.includes("cadastro com este email") ||
      normalized.includes("ja existe") ||
      normalized.includes("já existe") ||
      normalized.includes("faca login") ||
      normalized.includes("faça login") ||
      normalized.includes("conta encontrada")
    );
  }

  async function reserveNumbers() {
    if (!selected) return;
    if (selectedNumbers.length === 0) {
      toast.error("Escolha pelo menos um numero");
      return;
    }
    if (!participantName.trim() || !participantPhone.trim() || !participantEmail.trim() || (!loggedParticipant && !participantPassword.trim())) {
      toast.error("Informe nome, WhatsApp, e-mail e crie uma senha para reservar");
      return;
    }

    setReserving(true);
    setAccountRequiredMessage("");
    try {
      const token = localStorage.getItem(RAFFLE_TOKEN_KEY);
      const order = await api<ReserveResponse>(`/public/raffles/${selected.id}/reserve`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({
          numberIds: selectedNumbers,
          participant: {
            name: participantName,
            phone: participantPhone,
            email: participantEmail,
            password: participantPassword
          }
        })
      });
      if (order.token) {
        localStorage.setItem(RAFFLE_TOKEN_KEY, order.token);
      }
      const authToken = order.token || token;
      const pix = await api<RafflePixPayment>(`/public/raffles/orders/${order.id}/mercadopago/pix`, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined
      });
      setPixPayment(pix);
      toast.success(`Reserva criada: ${order.numbers.map((item) => item.formattedNumber).join(", ")}. Pague o Pix para confirmar.`);
      setSelectedNumbers([]);
      setNumbers(await publicRaffleJson<RaffleNumber[]>(`/public/raffles/${selected.id}/numbers`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao reservar numeros";
      if (isAccountAlreadyRegisteredMessage(message)) {
        openInlineLogin(message);
      }
      toast.error(message);
    } finally {
      setReserving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070912] text-white">
      <section className="mx-auto max-w-6xl px-4 py-8 md:py-14">
        <header className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur md:p-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-white text-ink">
                {company.logoUrl ? <img src={company.logoUrl} alt={company.tradeName} className="h-full w-full object-cover" /> : "HR"}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.45em] text-orange-300">HubRegional Rifas</p>
                <h1 className="font-display text-5xl">{company.tradeName}</h1>
                <p className="mt-2 max-w-2xl text-white/70">Escolha sua campanha, selecione seus numeros da sorte e acompanhe tudo com seguranca.</p>
              </div>
            </div>
            <Link href="/rifas/minha-conta" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink">
              Minha conta
            </Link>
          </div>
        </header>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-orange-300">Campanhas</p>
              <h2 className="font-display text-4xl">Rifas disponiveis</h2>
            </div>
            <div className="flex gap-2 text-xs">
              <Legend color="bg-emerald-500" label="Disponivel" />
              <Legend color="bg-orange-400" label="Reservado" />
              <Legend color="bg-red-500" label="Pago" />
            </div>
          </div>

          {loading && <p className="mt-6 rounded-3xl bg-white/10 p-6">Carregando rifas...</p>}
          {!loading && raffles.length === 0 && <p className="mt-6 rounded-3xl bg-white/10 p-6">Nenhuma rifa ativa no momento.</p>}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {raffles.map((raffle) => (
              <button key={raffle.id} onClick={() => setSelected(raffle)} className={`overflow-hidden rounded-[1.8rem] border text-left transition hover:-translate-y-1 ${selected?.id === raffle.id ? "border-orange-400 bg-orange-500/15" : "border-white/10 bg-white/10"}`}>
                <div className="h-52 bg-slate-800">
                  {raffle.featuredImageUrl ? <img src={raffle.featuredImageUrl} alt={raffle.title} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center font-display text-4xl opacity-50">RIFA</div>}
                </div>
                <div className="p-5">
                  <h3 className="text-2xl font-bold">{raffle.title}</h3>
                  <p className="mt-1 text-sm text-white/65">{raffle.prize || raffle.description || "Campanha promocional"}</p>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${raffle.progressPercent}%` }} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <strong>{BRL.format(raffle.pricePerNumber)} por numero</strong>
                    <span>{raffle.availableNumbers} disponiveis</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/rifas/${raffle.slug}`} onClick={(event) => event.stopPropagation()} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink">
                      Abrir pagina
                    </Link>
                    <button type="button" onClick={(event) => { event.stopPropagation(); copyRaffleUrl(raffle); }} className="rounded-xl border border-white/25 px-4 py-2 text-sm font-bold text-white">
                      Copiar link
                    </button>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {selected && (
          <section className="mt-8 rounded-[2rem] border border-white/10 bg-white p-5 text-ink md:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Escolha seus numeros</p>
                <h2 className="text-3xl font-bold">{selected.title}</h2>
                <p className="text-sm opacity-70">{selected.description || "Selecione apenas numeros disponiveis."}</p>
                <p className="mt-2 break-all rounded-xl bg-slate-100 px-3 py-2 text-xs opacity-80">
                  Link de divulgacao: {typeof window === "undefined" ? `/rifas/${selected.slug}` : raffleUrl(selected)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-100 px-4 py-3 text-right">
                <p className="text-xs opacity-60">Selecionado</p>
                <strong>{selectedNumbers.length} numero(s) • {BRL.format(total)}</strong>
              </div>
            </div>

            {selectedVideoUrls.length > 0 && (
              <section className="mt-5 rounded-3xl border border-orange-200 bg-orange-50/80 p-4 text-orange-950">
                <p className="text-xs font-black uppercase tracking-[0.35em] text-ember">Videos</p>
                <h3 className="mt-1 text-xl font-black">Veja a campanha</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {selectedVideoUrls.map((url, index) => (
                    <div key={`${url}-${index}`} className="overflow-hidden rounded-2xl border border-orange-200 bg-white">
                      {isDirectVideoUrl(url) ? (
                        <video controls className="aspect-video w-full bg-black object-cover" src={resolveAssetUrl(url)} />
                      ) : (
                        <a href={url} target="_blank" rel="noreferrer" className="flex min-h-28 items-center justify-between gap-3 p-4 font-bold text-ink">
                          <span>Assistir video {index + 1}</span>
                          <span className="rounded-full bg-ember px-3 py-1 text-xs text-white">Abrir</span>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-5 rounded-3xl border border-black/10 bg-slate-50 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-ember">Numeros da sorte</p>
                  <p className="text-sm text-slate-500">Toque em um ou mais numeros disponiveis para reservar.</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-700 shadow-sm">
                  {numbersLoading ? "Carregando..." : `${numbers.length} numeros`}
                </span>
              </div>

              {numbersLoading && (
                <div className="rounded-2xl bg-white p-5 text-center text-sm font-semibold text-slate-500">
                  Carregando numeros da rifa...
                </div>
              )}

              {!numbersLoading && numbers.length === 0 && (
                <div className="rounded-2xl bg-white p-5 text-center text-sm font-semibold text-slate-500">
                  Nenhum numero foi encontrado para esta rifa. Atualize a pagina ou confira a campanha no painel.
                </div>
              )}

              {!numbersLoading && numbers.length > 0 && (
                <div className="grid max-h-[28rem] grid-cols-5 gap-2 overflow-y-auto pr-1 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
                  {numbers.map((number) => {
                    const active = selectedNumbers.includes(number.id);
                    const tone = active
                      ? "bg-ink text-white ring-2 ring-ink/30"
                      : number.status === "AVAILABLE"
                        ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                        : ["RESERVED", "PENDING_PAYMENT"].includes(number.status)
                          ? "bg-orange-100 text-orange-800"
                          : number.status === "PAID"
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-200 text-slate-500";
                    return (
                      <button key={number.id} disabled={number.status !== "AVAILABLE"} onClick={() => toggleNumber(number)} className={`rounded-xl px-2 py-2 text-sm font-bold ${tone}`}>
                        {number.formattedNumber}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {selectedNumbers.length > 0 && (
              <div className="mt-5 rounded-2xl border border-black/10 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-ember">Cadastro do participante</p>
                {loggedParticipant ? (
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-bold text-emerald-800">Comprando como:</p>
                    <p className="mt-1 text-sm text-slate-700">{loggedParticipant.name} • {loggedParticipant.phone} • {loggedParticipant.email || "sem e-mail"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href="/rifas/minha-conta" className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white">
                        Minha conta
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.removeItem(RAFFLE_TOKEN_KEY);
                          setLoggedParticipant(null);
                          setParticipantName("");
                          setParticipantPhone("");
                          setParticipantEmail("");
                          setParticipantPassword("");
                        }}
                        className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600"
                      >
                        Trocar conta
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                      <p className="text-sm font-bold text-blue-900">Ja tem cadastro?</p>
                      <p className="mt-1 text-sm text-slate-600">Entre na sua conta para usar seus dados salvos, ver rifas compradas e continuar novas reservas.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openInlineLogin("Entre com sua conta para continuar esta reserva. Seus numeros selecionados ficam salvos nesta tela.")}
                          className="inline-flex rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white"
                        >
                          Entrar e continuar aqui
                        </button>
                        <Link href="/rifas/minha-conta" className="inline-flex rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-bold text-blue-900">
                          Ver minhas rifas
                        </Link>
                      </div>
                    </div>
                    {accountRequiredMessage && (
                      <div ref={accountLoginRef} className="mb-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                        <strong>Conta encontrada.</strong>
                        <p className="mt-1">{accountRequiredMessage}</p>
                        <form onSubmit={submitInlineLogin} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                          <input
                            value={inlineLogin}
                            onChange={(event) => setInlineLogin(event.target.value)}
                            className="rounded-xl border border-orange-200 bg-white px-4 py-3 text-ink"
                            placeholder="E-mail ou WhatsApp"
                          />
                          <input
                            value={inlinePassword}
                            onChange={(event) => setInlinePassword(event.target.value)}
                            className="rounded-xl border border-orange-200 bg-white px-4 py-3 text-ink"
                            placeholder="Senha"
                            type="password"
                          />
                          <button disabled={inlineLoginLoading} className="rounded-xl bg-orange-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">
                            {inlineLoginLoading ? "Entrando..." : "Entrar e continuar"}
                          </button>
                        </form>
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <input value={participantName} onChange={(event) => setParticipantName(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="Nome completo" />
                      <input value={participantPhone} onChange={(event) => setParticipantPhone(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="WhatsApp" />
                      <input value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="E-mail" type="email" />
                      <input value={participantPassword} onChange={(event) => setParticipantPassword(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="Crie uma senha para acessar depois" type="password" />
                    </div>
                    <p className="mt-3 text-xs opacity-60">
                      A reserva segura os numeros por {selected.reservationMinutes ?? 15} minutos. Com essa senha voce entra em Minha conta para ver suas compras e resultado.
                    </p>
                  </>
                )}
              </div>
            )}

            {pixPayment && (
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-700">Mercado Pago</p>
                    <h3 className="text-2xl font-bold text-ink">{pixPayment.paid ? "Pagamento confirmado" : "Pague com Pix"}</h3>
                    <p className="text-sm text-slate-600">
                      {pixPayment.paid
                        ? "Seus numeros foram confirmados como pagos."
                        : "Escaneie o QR Code ou copie o codigo Pix. A tela atualiza automaticamente apos a confirmacao."}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-bold ${pixPayment.paid ? "bg-emerald-600 text-white" : "bg-orange-100 text-orange-700"}`}>
                    {pixPayment.paid ? "Pago" : "Aguardando pagamento"}
                  </span>
                </div>

                {!pixPayment.paid && (
                  <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
                    <div className="rounded-2xl bg-white p-3 shadow-sm">
                      {pixPayment.qrCodeBase64 ? (
                        <img src={`data:image/png;base64,${pixPayment.qrCodeBase64}`} alt="QR Code Pix Mercado Pago" className="h-full w-full object-contain" />
                      ) : (
                        <div className="grid h-48 place-items-center rounded-xl bg-slate-100 text-center text-sm text-slate-500">QR Code indisponivel. Use o copia e cola.</div>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-bold uppercase text-slate-500">Pix copia e cola</p>
                      <textarea readOnly value={pixPayment.qrCode ?? ""} className="h-36 w-full rounded-xl border bg-white p-3 text-sm" />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(pixPayment.qrCode ?? "");
                            toast.success("Codigo Pix copiado");
                          }}
                          className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white"
                        >
                          Copiar codigo Pix
                        </button>
                        {pixPayment.ticketUrl && (
                          <a href={pixPayment.ticketUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-black/10 px-4 py-2 text-sm font-bold">
                            Abrir Mercado Pago
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="sticky bottom-3 mt-6 rounded-2xl bg-ink p-4 text-white shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm opacity-70">Informe seus dados para reservar e pagar via Pix Mercado Pago.</p>
                  <strong>{selectedNumbers.length} numero(s) selecionado(s) • {BRL.format(total)}</strong>
                </div>
                <button className="rounded-xl bg-ember px-5 py-3 font-bold disabled:opacity-60" disabled={reserving} onClick={() => void reserveNumbers()}>
                  {reserving ? "Gerando Pix..." : "Reservar e pagar Pix"}
                </button>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${color}`} />{label}</span>;
}
