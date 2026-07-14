"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { PublicCompany } from "../lib/types";

type Raffle = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  prize?: string | null;
  featuredImageUrl?: string | null;
  pricePerNumber: number;
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
  numbers: Array<{ formattedNumber: string }>;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RaffleStorefront({ company, initialSlug }: { company: PublicCompany; initialSlug?: string }) {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [selected, setSelected] = useState<Raffle | null>(null);
  const [numbers, setNumbers] = useState<RaffleNumber[]>([]);
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([]);
  const [participantName, setParticipantName] = useState("");
  const [participantPhone, setParticipantPhone] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantPassword, setParticipantPassword] = useState("");
  const [reserving, setReserving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Raffle[]>("/public/raffles")
      .then((payload) => {
        setRaffles(payload);
        if (!initialSlug) return;
        const raffle = payload.find((item) => item.slug === initialSlug);
        if (raffle) {
          setSelected(raffle);
          return;
        }
        api<Raffle>(`/public/raffles/${initialSlug}`)
          .then(setSelected)
          .catch(() => toast.error("Rifa nao encontrada ou indisponivel"));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar rifas"))
      .finally(() => setLoading(false));
  }, [initialSlug]);

  useEffect(() => {
    if (!selected) return;
    setSelectedNumbers([]);
    api<RaffleNumber[]>(`/public/raffles/${selected.id}/numbers`)
      .then(setNumbers)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar numeros"));
  }, [selected]);

  const total = useMemo(() => selectedNumbers.length * (selected?.pricePerNumber ?? 0), [selectedNumbers, selected]);

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

  async function reserveNumbers() {
    if (!selected) return;
    if (selectedNumbers.length === 0) {
      toast.error("Escolha pelo menos um numero");
      return;
    }
    if (!participantName.trim() || !participantPhone.trim() || !participantEmail.trim()) {
      toast.error("Informe nome, WhatsApp e e-mail para reservar");
      return;
    }

    setReserving(true);
    try {
      const order = await api<ReserveResponse>(`/public/raffles/${selected.id}/reserve`, {
        method: "POST",
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
      toast.success(`Reserva criada: ${order.numbers.map((item) => item.formattedNumber).join(", ")}`);
      setSelectedNumbers([]);
      setNumbers(await api<RaffleNumber[]>(`/public/raffles/${selected.id}/numbers`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reservar numeros");
    } finally {
      setReserving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070912] text-white">
      <section className="mx-auto max-w-6xl px-4 py-8 md:py-14">
        <header className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur md:p-10">
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

            <div className="mt-5 grid grid-cols-5 gap-2 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
              {numbers.map((number) => {
                const active = selectedNumbers.includes(number.id);
                const tone = active
                  ? "bg-ink text-white"
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

            {selectedNumbers.length > 0 && (
              <div className="mt-5 rounded-2xl border border-black/10 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-ember">Cadastro do participante</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={participantName} onChange={(event) => setParticipantName(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="Nome completo" />
                  <input value={participantPhone} onChange={(event) => setParticipantPhone(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="WhatsApp" />
                  <input value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="E-mail" type="email" />
                  <input value={participantPassword} onChange={(event) => setParticipantPassword(event.target.value)} className="rounded-xl border px-4 py-3" placeholder="Senha para acessar depois (opcional)" type="password" />
                </div>
                <p className="mt-3 text-xs opacity-60">A reserva segura os numeros por 15 minutos. A proxima etapa liga isso ao Mercado Pago.</p>
              </div>
            )}

            <div className="sticky bottom-3 mt-6 rounded-2xl bg-ink p-4 text-white shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm opacity-70">Informe seus dados para reservar por 15 minutos.</p>
                  <strong>{selectedNumbers.length} numero(s) selecionado(s) • {BRL.format(total)}</strong>
                </div>
                <button className="rounded-xl bg-ember px-5 py-3 font-bold disabled:opacity-60" disabled={reserving} onClick={() => void reserveNumbers()}>
                  {reserving ? "Reservando..." : "Reservar numeros"}
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
