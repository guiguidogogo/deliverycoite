"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

type FinanceSummary = {
  session: {
    id: string;
    openedAt: string;
    openingAmount: string;
    closedAt?: string | null;
    entries?: Array<{
      id: string;
      type: "OPENING" | "WITHDRAWAL" | "EXPENSE" | "MANUAL_INCOME" | "CLOSING";
      amount: string;
      description?: string | null;
      createdAt: string;
    }>;
  } | null;
  totals: {
    cashOrders: number;
    pixOrders: number;
    cardOrders: number;
    withdrawals: number;
    expenses: number;
    manualIncome: number;
    expectedCash: number;
  };
  history?: Array<{
    id: string;
    type: "OPENING" | "WITHDRAWAL" | "EXPENSE" | "MANUAL_INCOME" | "CLOSING";
    amount: number;
    paymentMethod?: "CASH" | "PIX" | "CARD" | null;
    orderId?: string | null;
    orderCode?: string | null;
    description?: string | null;
    createdAt: string;
  }>;
};

export default function FinanceManagePage() {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingAmount, setOpeningAmount] = useState("100");
  const [closingAmount, setClosingAmount] = useState("0");
  const [entryType, setEntryType] = useState("WITHDRAWAL");
  const [entryAmount, setEntryAmount] = useState("0");
  const [entryDescription, setEntryDescription] = useState("");

  async function authFetch(path: string, init?: RequestInit) {
    const token = localStorage.getItem("delivery:token");
    if (!token) throw new Error("Token nao encontrado");

    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.message ?? "Erro na requisicao");
    }

    if (res.status === 204) return null;
    return res.json();
  }

  async function load() {
    const payload = (await authFetch("/admin/finance/summary")) as FinanceSummary;
    setSummary(payload);
    setClosingAmount(String(payload.totals.expectedCash.toFixed(2)));
    setLoading(false);
  }

  useEffect(() => {
    void load();

    const onPayment = () => {
      void load();
    };

    window.addEventListener("delivery:payment-updated", onPayment);
    const timer = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      window.removeEventListener("delivery:payment-updated", onPayment);
      window.clearInterval(timer);
    };
  }, []);

  async function openCash() {
    try {
      await authFetch("/admin/finance/open", {
        method: "POST",
        body: JSON.stringify({ openingAmount: Number(openingAmount) })
      });
      toast.success("Caixa aberto");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao abrir caixa");
    }
  }

  async function addEntry() {
    try {
      await authFetch("/admin/finance/entry", {
        method: "POST",
        body: JSON.stringify({
          type: entryType,
          amount: Number(entryAmount),
          description: entryDescription || undefined
        })
      });
      toast.success("Movimento registrado");
      setEntryAmount("0");
      setEntryDescription("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao registrar movimento");
    }
  }

  async function closeCash() {
    try {
      await authFetch("/admin/finance/close", {
        method: "POST",
        body: JSON.stringify({ closingAmount: Number(closingAmount) })
      });
      toast.success("Caixa fechado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao fechar caixa");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Financeiro e Caixa</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      {loading ? (
        <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
          <p>Carregando financeiro...</p>
        </section>
      ) : !summary?.session ? (
        <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold">Abertura de caixa</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} placeholder="Valor inicial" />
            <button className="rounded-xl bg-ember px-4 py-2 text-white" onClick={() => void openCash()}>
              Abrir caixa
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric title="Abertura" value={`R$ ${Number(summary.session.openingAmount).toFixed(2)}`} />
            <Metric title="Dinheiro pedidos" value={`R$ ${summary.totals.cashOrders.toFixed(2)}`} />
            <Metric title="Entradas manuais" value={`R$ ${summary.totals.manualIncome.toFixed(2)}`} />
            <Metric title="Sangrias/saidas" value={`R$ ${(summary.totals.withdrawals + summary.totals.expenses).toFixed(2)}`} />
            <Metric title="PIX" value={`R$ ${summary.totals.pixOrders.toFixed(2)}`} />
            <Metric title="Cartao" value={`R$ ${summary.totals.cardOrders.toFixed(2)}`} />
            <Metric title="Caixa esperado" value={`R$ ${summary.totals.expectedCash.toFixed(2)}`} />
            <Metric title="Aberto em" value={new Date(summary.session.openedAt).toLocaleString("pt-BR")} />
          </section>

          <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
            <h2 className="text-lg font-semibold">Lancar movimento</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                <option value="WITHDRAWAL">Sangria</option>
                <option value="EXPENSE">Despesa</option>
                <option value="MANUAL_INCOME">Entrada manual</option>
              </select>
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} placeholder="Valor" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" value={entryDescription} onChange={(e) => setEntryDescription(e.target.value)} placeholder="Descricao" />
              <button className="rounded-xl bg-ink px-3 py-2 text-white md:col-span-4" onClick={() => void addEntry()}>
                Registrar movimento
              </button>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
            <h2 className="text-lg font-semibold">Fechamento de caixa</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} placeholder="Valor contado" />
              <button className="rounded-xl bg-red-600 px-4 py-2 text-white" onClick={() => void closeCash()}>
                Fechar caixa
              </button>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
            <h2 className="text-lg font-semibold">Historico de movimentos</h2>
            <div className="mt-3 space-y-2">
              {(summary.history ?? []).map((entry) => (
                <article key={entry.id} className="rounded-lg border border-black/10 p-2 text-sm dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{labelEntry(entry.type, Boolean(entry.paymentMethod))}</p>
                    <p>R$ {Number(entry.amount).toFixed(2)}</p>
                  </div>
                  {entry.paymentMethod && (
                    <p className="text-xs opacity-70">Forma: {labelPayment(entry.paymentMethod)}</p>
                  )}
                  {entry.orderCode && (
                    <p className="text-xs opacity-70">Pedido: #{entry.orderCode}</p>
                  )}
                  <p className="text-xs opacity-70">{entry.description || "Sem descricao"}</p>
                  <p className="text-xs opacity-60">{new Date(entry.createdAt).toLocaleString("pt-BR")}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function labelEntry(
  type: "OPENING" | "WITHDRAWAL" | "EXPENSE" | "MANUAL_INCOME" | "CLOSING",
  isOrderPayment = false
) {
  if (type === "OPENING") return "Abertura";
  if (type === "WITHDRAWAL") return "Sangria";
  if (type === "EXPENSE") return "Despesa";
  if (isOrderPayment) return "Pagamento de pedido";
  if (type === "MANUAL_INCOME") return "Entrada manual";
  return "Fechamento";
}

function labelPayment(type: "CASH" | "PIX" | "CARD") {
  if (type === "CASH") return "Dinheiro";
  if (type === "PIX") return "PIX";
  return "Cartao";
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white/85 p-3 dark:border-white/10 dark:bg-slate-900/70">
      <p className="text-xs opacity-70">{title}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
