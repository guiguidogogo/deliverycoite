"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [mode, setMode] = useState<"login" | "register">("login");
  const [registerName, setRegisterName] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerCpf, setRegisterCpf] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [token, setToken] = useState("");
  const [account, setAccount] = useState<RaffleAccountPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState("");
  const notifiedPaidOrders = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!token || pendingOrders.length === 0) return;

    const interval = window.setInterval(() => {
      Promise.allSettled(
        pendingOrders.map((order) =>
          api<{ paid: boolean }>(`/public/raffles/orders/${order.id}/mercadopago/status`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        )
      )
        .then((results) => {
          const newlyPaid = results.some((result, index) => {
            const orderId = pendingOrders[index]?.id;
            if (result.status !== "fulfilled" || !result.value.paid || !orderId || notifiedPaidOrders.current.has(orderId)) {
              return false;
            }
            notifiedPaidOrders.current.add(orderId);
            return true;
          });
          if (newlyPaid) {
            toast.success("Pagamento confirmado! Seus numeros foram liberados.");
          }
          return loadAccount(token);
        })
        .catch(() => undefined);
    }, 8000);

    return () => window.clearInterval(interval);
  }, [token, pendingOrders.map((order) => order.id).join("|")]);

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

  async function submitRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await api<LoginResponse>("/public/raffles/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: registerName,
          phone: registerPhone,
          email: registerEmail,
          cpf: registerCpf,
          password: registerPassword
        })
      });
      toast.success("Conta criada. Agora voce pode acompanhar suas rifas.");
      await loadAccount(response.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao criar conta";
      toast.error(message);
      if (message.toLowerCase().includes("ja existe")) {
        setMode("login");
        setLogin(registerEmail || registerPhone);
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestPasswordReset() {
    if (!login.trim()) {
      toast.error("Informe seu e-mail ou WhatsApp");
      return;
    }

    setResetLoading(true);
    try {
      const response = await api<{ message: string }>("/public/raffles/auth/password/request", {
        method: "POST",
        body: JSON.stringify({ login })
      });
      setRecoveringPassword(true);
      toast.success(response.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel enviar o codigo");
    } finally {
      setResetLoading(false);
    }
  }

  async function confirmPasswordReset() {
    if (resetCode.trim().length !== 6 || newPassword.length < 6) {
      toast.error("Informe o codigo de 6 digitos e uma nova senha com pelo menos 6 caracteres");
      return;
    }

    setResetLoading(true);
    try {
      await api("/public/raffles/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({
          login,
          code: resetCode,
          newPassword
        })
      });
      setRecoveringPassword(false);
      setResetCode("");
      setNewPassword("");
      setPassword("");
      toast.success("Senha alterada. Entre com sua nova senha.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel alterar a senha");
    } finally {
      setResetLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAccount(null);
    setPassword("");
    toast.info("Voce saiu da conta");
  }

  async function createPixPayment(orderId: string) {
    setPayingOrderId(orderId);
    try {
      const payment = await api<RafflePixPayment>(`/public/raffles/orders/${orderId}/mercadopago/pix`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (payment.paid) {
        if (!notifiedPaidOrders.current.has(orderId)) {
          notifiedPaidOrders.current.add(orderId);
          toast.success("Pagamento confirmado!");
        }
      } else {
        toast.success("Pix Mercado Pago gerado. Pague pelo QR Code ou copia e cola.");
      }
      await loadAccount(token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel gerar o Pix");
    } finally {
      setPayingOrderId("");
    }
  }

  async function refreshPayment(orderId: string) {
    try {
      const status = await api<{ paid: boolean }>(`/public/raffles/orders/${orderId}/mercadopago/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      if (status.paid) {
        if (!notifiedPaidOrders.current.has(orderId)) {
          notifiedPaidOrders.current.add(orderId);
          toast.success("Pagamento confirmado!");
        } else {
          toast.info("Pagamento ja confirmado");
        }
      }
      else toast.info("Pagamento ainda pendente");
      await loadAccount(token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel consultar o pagamento");
    }
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
          <section className="mx-auto mt-8 max-w-lg rounded-[2rem] bg-white p-6 text-ink shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Acesso do comprador</p>
            <h2 className="mt-1 text-3xl font-bold">{mode === "login" ? "Entrar nas minhas rifas" : "Criar minha conta"}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {mode === "login"
                ? "Use o e-mail ou WhatsApp informado na compra e a senha criada na reserva."
                : "Crie sua conta uma vez para reutilizar seus dados e acompanhar compras, pagamentos e resultados."}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === "login" ? "bg-ink text-white shadow-sm" : "text-slate-600"}`}
              >
                Ja tenho conta
              </button>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={`rounded-xl px-4 py-2 text-sm font-bold ${mode === "register" ? "bg-ink text-white shadow-sm" : "text-slate-600"}`}
              >
                Criar conta
              </button>
            </div>

            {mode === "login" ? (
              <form onSubmit={submitLogin} className="mt-5 grid gap-3">
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
                {!recoveringPassword ? (
                  <button
                    type="button"
                    disabled={resetLoading}
                    onClick={() => void requestPasswordReset()}
                    className="rounded-xl px-4 py-2 text-sm font-bold text-ember underline decoration-orange-300 underline-offset-4 disabled:opacity-60"
                  >
                    {resetLoading ? "Enviando codigo..." : "Esqueci minha senha"}
                  </button>
                ) : (
                  <div className="grid gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
                    <p className="text-sm text-orange-950">
                      Digite o codigo de 6 digitos enviado ao seu WhatsApp. Ele vale por 15 minutos.
                    </p>
                    <input
                      value={resetCode}
                      onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="rounded-xl border border-orange-200 bg-white px-4 py-3"
                      placeholder="Codigo de 6 digitos"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                    />
                    <input
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="rounded-xl border border-orange-200 bg-white px-4 py-3"
                      placeholder="Nova senha"
                      type="password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      disabled={resetLoading}
                      onClick={() => void confirmPasswordReset()}
                      className="rounded-xl bg-ember px-5 py-3 font-bold text-white disabled:opacity-60"
                    >
                      {resetLoading ? "Alterando..." : "Alterar senha"}
                    </button>
                    <button
                      type="button"
                      disabled={resetLoading}
                      onClick={() => {
                        setRecoveringPassword(false);
                        setResetCode("");
                        setNewPassword("");
                      }}
                      className="text-sm font-bold text-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={submitRegister} className="mt-5 grid gap-3">
                <input
                  value={registerName}
                  onChange={(event) => setRegisterName(event.target.value)}
                  className="rounded-xl border px-4 py-3"
                  placeholder="Nome completo"
                  autoComplete="name"
                />
                <input
                  value={registerPhone}
                  onChange={(event) => setRegisterPhone(event.target.value)}
                  className="rounded-xl border px-4 py-3"
                  placeholder="WhatsApp"
                  autoComplete="tel"
                />
                <input
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                  className="rounded-xl border px-4 py-3"
                  placeholder="E-mail"
                  type="email"
                  autoComplete="email"
                />
                <input
                  value={registerCpf}
                  onChange={(event) => setRegisterCpf(event.target.value)}
                  className="rounded-xl border px-4 py-3"
                  placeholder="CPF opcional"
                  autoComplete="off"
                />
                <input
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  className="rounded-xl border px-4 py-3"
                  placeholder="Senha de acesso"
                  type="password"
                  autoComplete="new-password"
                />
                <button disabled={loading} className="rounded-xl bg-ember px-5 py-3 font-bold text-white disabled:opacity-60">
                  {loading ? "Criando..." : "Criar conta e entrar"}
                </button>
              </form>
            )}
          </section>
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
                  <OrderCard
                    key={order.id}
                    order={order}
                    showPix
                    paying={payingOrderId === order.id}
                    onCreatePix={() => void createPixPayment(order.id)}
                    onRefreshPayment={() => void refreshPayment(order.id)}
                  />
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

function OrderCard({
  order,
  showPix = false,
  paying = false,
  onCreatePix,
  onRefreshPayment
}: {
  order: RaffleAccountOrder;
  showPix?: boolean;
  paying?: boolean;
  onCreatePix?: () => void;
  onRefreshPayment?: () => void;
}) {
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

      {showPix && (
        order.pixCopiaCola ? (
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
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(order.pixCopiaCola ?? "");
                    toast.success("Codigo Pix copiado");
                  }}
                  className="rounded-xl bg-ink px-4 py-2 text-sm font-bold text-white"
                >
                  Copiar codigo Pix
                </button>
                {onRefreshPayment && (
                  <button type="button" onClick={onRefreshPayment} className="rounded-xl border px-4 py-2 text-sm font-bold">
                    Ja paguei / atualizar
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl bg-orange-50 p-4">
            <p className="text-sm font-bold text-orange-800">Esta reserva ainda nao tem Pix gerado.</p>
            <p className="mt-1 text-sm text-orange-700">Clique para gerar o QR Code Mercado Pago e finalizar sua compra.</p>
            {onCreatePix && (
              <button
                type="button"
                onClick={onCreatePix}
                disabled={paying}
                className="mt-3 rounded-xl bg-ember px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {paying ? "Gerando Pix..." : "Pagar agora com Pix"}
              </button>
            )}
          </div>
        )
      )}

      {order.paidAt && <p className="mt-3 text-sm text-emerald-700">Pagamento confirmado em {formatDate(order.paidAt)}</p>}
      {order.reservationExpiresAt && statusLabel(order) === "Pendente" && (
        <p className="mt-3 text-sm text-orange-700">Reserva valida ate {formatDate(order.reservationExpiresAt)}</p>
      )}
    </article>
  );
}
