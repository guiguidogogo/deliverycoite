"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";

type Participant = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  cpf?: string | null;
};

type RaffleAccountOrder = {
  id: string;
  raffle: {
    title: string;
    slug: string;
    prize?: string | null;
    featuredImageUrl?: string | null;
    endsAt?: string | null;
  };
  status: string;
  paymentStatus: string;
  paymentMethod?: string | null;
  total: number;
  paidAt?: string | null;
  reservationExpiresAt?: string | null;
  createdAt: string;
  pixQrCode?: string | null;
  pixCopiaCola?: string | null;
  numbers: Array<{ formattedNumber: string; price: number }>;
  latestPayment?: {
    providerPaymentId?: string | null;
    method?: string | null;
    status: string;
  } | null;
};

type RaffleWinner = {
  id: string;
  raffleTitle: string;
  raffleSlug: string;
  prize?: string | null;
  formattedNumber: string;
  participantName?: string | null;
  proofUrl?: string | null;
  notes?: string | null;
  drawnAt: string;
};

type RaffleAccountPayload = {
  participant: Participant;
  orders: RaffleAccountOrder[];
  winners: RaffleWinner[];
};

type LoginResponse = {
  token: string;
  participant: Participant;
};

const TOKEN_KEY = "hubregional:raffleParticipantToken";
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function statusLabel(order: RaffleAccountOrder) {
  if (order.paymentStatus === "APPROVED" || order.status === "PAID") return "Pago";
  if (order.status === "REFUNDED" || order.paymentStatus === "REFUNDED") return "Estornado";
  if (["EXPIRED", "CANCELLED"].includes(order.status)) return "Cancelado";
  return "Pendente";
}

function statusClass(order: RaffleAccountOrder) {
  const label = statusLabel(order);
  if (label === "Pago") return "bg-emerald-100 text-emerald-700";
  if (label === "Estornado") return "bg-purple-100 text-purple-700";
  if (label === "Cancelado") return "bg-red-100 text-red-700";
  return "bg-orange-100 text-orange-700";
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function RaffleAccountPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<RaffleAccountPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const pendingOrders = useMemo(
    () => account?.orders.filter((order) => statusLabel(order) === "Pendente") ?? [],
    [account]
  );
  const paidOrders = useMemo(
    () => account?.orders.filter((order) => statusLabel(order) !== "Pendente") ?? [],
    [account]
  );

  async function loadAccount(nextToken = token) {
    if (!nextToken) return;
    setLoading(true);
    try {
      const payload = await api<RaffleAccountPayload>("/public/raffles/account/me", {
        headers: { Authorization: `Bearer ${nextToken}` }
      });
      setAccount(payload);
      setToken(nextToken);
      localStorage.setItem(TOKEN_KEY, nextToken);
    } catch (error) {
      localStorage.removeItem(TOKEN_KEY);
      setToken("");
      setAccount(null);
      toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar sua conta");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY) ?? "";
    if (stored) void loadAccount(stored);
  }, []);

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await api<LoginResponse>("/public/raffles/auth/login", {
        method: "POST",
        body: JSON.stringify({ login, password })
      });
      toast.success("Login realizado");
      await loadAccount(response.token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAccount(null);
    setPassword("");
    toast.info("Voce saiu da conta");
  }

  return (
    <main className="min-h-screen bg-[#070912] px-4 py-8 text-white">
      <section className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-white/10 bg-white/10 p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.4em] text-orange-300">HubRegional Rifas</p>
            <h1 className="font-display text-4xl">Minha conta</h1>
            <p className="mt-1 text-white/70">Veja suas rifas compradas, pagamentos, numeros e resultado de campeao.</p>
          </div>
          <Link href="/" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-ink">
            Ver rifas
          </Link>
        </header>

        {!account && (
          <form onSubmit={submitLogin} className="mx-auto mt-8 max-w-lg rounded-[2rem] bg-white p-6 text-ink shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Acesso do comprador</p>
            <h2 className="mt-1 text-3xl font-bold">Entrar nas minhas rifas</h2>
            <p className="mt-2 text-sm text-slate-600">
              Use o e-mail ou WhatsApp informado na compra e a senha criada na reserva.
            </p>
            <div className="mt-5 grid gap-3">
              <input
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                className="rounded-xl border px-4 py-3"
                placeholder="E-mail ou WhatsApp"
                autoComplete="username"
              />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-xl border px-4 py-3"
                placeholder="Senha"
                type="password"
                autoComplete="current-password"
              />
              <button disabled={loading} className="rounded-xl bg-ink px-5 py-3 font-bold text-white disabled:opacity-60">
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </div>
          </form>
        )}

        {account && (
          <div className="mt-8 grid gap-5">
            <section className="rounded-[2rem] bg-white p-5 text-ink">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Dados cadastrados</p>
                  <h2 className="text-3xl font-bold">{account.participant.name}</h2>
                  <p className="text-sm text-slate-600">{account.participant.email || "-"} • {account.participant.phone}</p>
                </div>
                <button onClick={logout} className="rounded-xl border border-red-200 px-4 py-2 text-sm font-bold text-red-600">
                  Sair da conta
                </button>
              </div>
            </section>

            {account.winners.length > 0 && (
              <section className="rounded-[2rem] border border-yellow-300 bg-yellow-50 p-5 text-ink">
                <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-700">Resultado</p>
                <h2 className="text-3xl font-bold">Voce tem numero campeao</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {account.winners.map((winner) => (
                    <article key={winner.id} className="rounded-2xl bg-white p-4 shadow-sm">
                      <strong>{winner.raffleTitle}</strong>
                      <p className="mt-1 text-sm text-slate-600">Numero sorteado: <b>{winner.formattedNumber}</b></p>
                      <p className="text-sm text-slate-600">Premio: {winner.prize || "Premio da campanha"}</p>
                      <p className="text-xs text-slate-500">Sorteado em {formatDate(winner.drawnAt)}</p>
                      {winner.proofUrl && <a href={winner.proofUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-ember">Ver comprovante</a>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-[2rem] bg-white p-5 text-ink">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Pagamentos pendentes</p>
                  <h2 className="text-3xl font-bold">Finalize suas reservas</h2>
                </div>
                <button onClick={() => void loadAccount()} className="rounded-xl border px-4 py-2 text-sm font-bold">
                  Atualizar
                </button>
              </div>

              {pendingOrders.length === 0 && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Nenhum pagamento pendente.</p>}
              <div className="mt-4 grid gap-4">
                {pendingOrders.map((order) => (
                  <OrderCard key={order.id} order={order} showPix />
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] bg-white p-5 text-ink">
              <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Minhas rifas</p>
              <h2 className="text-3xl font-bold">Compras e numeros</h2>
              {paidOrders.length === 0 && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">Nenhuma compra confirmada ainda.</p>}
              <div className="mt-4 grid gap-4">
                {paidOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function OrderCard({ order, showPix = false }: { order: RaffleAccountOrder; showPix?: boolean }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold">{order.raffle.title}</h3>
          <p className="text-sm text-slate-600">{order.raffle.prize || "Campanha de rifa"}</p>
          <p className="mt-1 text-xs text-slate-500">Compra em {formatDate(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${statusClass(order)}`}>{statusLabel(order)}</span>
          <p className="mt-2 font-bold">{BRL.format(order.total)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {order.numbers.map((number) => (
          <span key={number.formattedNumber} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold">
            {number.formattedNumber}
          </span>
        ))}
      </div>

      {showPix && order.pixCopiaCola && (
        <div className="mt-4 grid gap-4 rounded-2xl bg-emerald-50 p-4 md:grid-cols-[180px_1fr]">
          <div className="rounded-xl bg-white p-2">
            {order.pixQrCode ? (
              <img src={`data:image/png;base64,${order.pixQrCode}`} alt="QR Code Pix" className="h-full w-full object-contain" />
            ) : (
              <div className="grid h-40 place-items-center text-center text-sm text-slate-500">Use o copia e cola.</div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-emerald-800">Pix copia e cola</p>
            <textarea readOnly value={order.pixCopiaCola} className="mt-2 h-28 w-full rounded-xl border bg-white p-3 text-sm" />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(order.pixCopiaCola ?? "");
                toast.success("Codigo Pix copiado");
              }}
              className="mt-2 rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white"
            >
              Copiar codigo Pix
            </button>
          </div>
        </div>
      )}

      {order.paidAt && <p className="mt-3 text-sm text-emerald-700">Pagamento confirmado em {formatDate(order.paidAt)}</p>}
      {order.reservationExpiresAt && statusLabel(order) === "Pendente" && (
        <p className="mt-3 text-sm text-orange-700">Reserva valida ate {formatDate(order.reservationExpiresAt)}</p>
      )}
    </article>
  );
}
