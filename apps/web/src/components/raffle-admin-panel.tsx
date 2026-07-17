"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../lib/admin-api";

type Raffle = {
  id: string;
  slug: string;
  title: string;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED" | "FINISHED";
  totalNumbers: number;
  pricePerNumber: number;
  _count?: { numbers: number; orders: number; participants: number };
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function RaffleAdminPanel() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi<Raffle[]>("/admin/raffles")
      .then(setRaffles)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar rifas"))
      .finally(() => setLoading(false));
  }, []);

  const active = raffles.filter((raffle) => raffle.status === "ACTIVE").length;
  const totalOrders = raffles.reduce((sum, raffle) => sum + (raffle._count?.orders ?? 0), 0);
  const totalParticipants = raffles.reduce((sum, raffle) => sum + (raffle._count?.participants ?? 0), 0);

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="rounded-[2rem] bg-gradient-to-br from-purple-900 via-slate-950 to-orange-700 p-6 text-white shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.4em] text-orange-200">HubRegional Rifas</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-5xl">Painel de Rifas</h1>
            <p className="mt-2 max-w-2xl text-white/80">
              Área administrativa própria para campanhas numeradas, reservas, pagamentos, participantes e sorteios.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-xl bg-white px-4 py-3 font-bold text-slate-950" href="/admin/manage/raffles">
              Nova rifa
            </Link>
            <Link className="rounded-xl bg-white/15 px-4 py-3 font-bold text-white" href="/admin/manage/settings#raffle-integrations">
              Integrações
            </Link>
          </div>
        </div>
      </header>

      <section className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="Campanhas" value={raffles.length} />
        <Metric label="Ativas" value={active} />
        <Metric label="Reservas/Pedidos" value={totalOrders} />
        <Metric label="Participantes" value={totalParticipants} />
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <AdminShortcut title="Rifas" description="Criar, editar e publicar campanhas." href="/admin/manage/raffles" />
        <AdminShortcut title="Participantes" description="Base de compradores e interessados." disabled />
        <AdminShortcut title="Pagamentos" description="Acompanhar Pix, cartão e confirmações." disabled />
        <AdminShortcut title="Sorteios" description="Apuração, ganhadores e auditoria." disabled />
        <AdminShortcut title="Relatórios" description="Vendas, números e conversão." disabled />
        <AdminShortcut title="Integrações" description="Mercado Pago, WhatsApp/MenuIA e e-mail." href="/admin/manage/settings#raffle-integrations" />
      </section>

      <section className="mt-6 rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-purple-700">Campanhas recentes</p>
            <h2 className="text-2xl font-bold">Suas rifas</h2>
          </div>
          <Link className="rounded-xl bg-ink px-4 py-2 font-bold text-white" href="/admin/manage/raffles">
            Gerenciar
          </Link>
        </div>

        <div className="mt-4 space-y-3">
          {loading && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Carregando rifas...</p>}
          {!loading && raffles.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">
              Nenhuma rifa cadastrada ainda. Clique em “Nova rifa” para criar a primeira campanha.
            </p>
          )}
          {raffles.slice(0, 6).map((raffle) => (
            <div key={raffle.id} className="rounded-2xl border border-black/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">{raffle.title}</h3>
                  <p className="text-sm opacity-65">
                    {raffle.totalNumbers} número(s) • {BRL.format(raffle.pricePerNumber)} por número • {raffle.status}
                  </p>
                </div>
                <Link className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white" href="/admin/manage/raffles">
                  Abrir
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
      <p className="text-sm opacity-60">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
    </div>
  );
}

function AdminShortcut({ title, description, href, disabled }: { title: string; description: string; href?: string; disabled?: boolean }) {
  const content = (
    <div className={`rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70 ${disabled ? "opacity-55" : ""}`}>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="mt-2 text-sm opacity-70">{description}</p>
      <p className="mt-4 text-sm font-bold text-purple-700">{disabled ? "Em breve" : "Acessar"}</p>
    </div>
  );

  if (disabled || !href) return content;
  return <a href={href}>{content}</a>;
}
