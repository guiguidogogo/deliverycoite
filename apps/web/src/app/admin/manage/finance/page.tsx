"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { API_URL, apiFetch } from "../../../../lib/api";

type Tab = "dashboard" | "cash" | "payables" | "receivables" | "history" | "audit";
type Summary = {
  session: null | { id: string; operatorName: string; openingAmount: number; openedAt: string; notes?: string };
  totals: null | {
    cash: number; pix: number; credit: number; debit: number; cardOther: number;
    totalSales: number; withdrawals: number; expenses: number; otherIncome: number; expectedCash: number;
  };
  history: Array<{
    id: string; category?: string; direction: string; amount: number; paymentDetail?: string;
    operatorName?: string; reason?: string; description?: string; createdAt: string; deletedAt?: string;
    orderCode?: string;
  }>;
};
type Dashboard = {
  revenueToday: number; revenueWeek: number; revenueMonth: number; averageTicket: number;
  ordersToday: number; estimatedProfit: number; expensesToday: number; expensesMonth: number;
  currentBalance: number; openCashRegisters: number; closedCashRegisters: number;
  overduePayables: number; dueSoonPayables: number;
  daily: Array<{ date: string; sales: number }>;
  monthly: Array<{ month: string; sales: number }>;
  paymentMethods: Record<string, number>;
};
type Account = {
  id: string; description?: string; customerName?: string; category?: string; amount: number;
  dueDate: string; status: string; effectiveStatus: string; notes?: string;
};
type Session = {
  id: string; openedBy: string; operatorName?: string; openedAt: string; closedAt?: string;
  openingAmount: number; closingAmount?: number; expectedAmount?: number; difference?: number;
  closingNotes?: string; locked: boolean; reopenReason?: string;
  totals: { totalSales: number; expenses: number; expectedCash: number };
};
type Audit = {
  id: string; userName?: string; action: string; entity: string; entityId?: string;
  oldValue?: unknown; newValue?: unknown; ipAddress?: string; device?: string; createdAt: string;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const entryOptions = [
  ["WITHDRAWAL", "Sangria"], ["EMERGENCY_PURCHASE", "Compra emergencial"],
  ["EMPLOYEE_ADVANCE", "Vale funcionário"], ["SUPPLIER_PAYMENT", "Pagamento fornecedor"],
  ["INITIAL_CHANGE", "Troco inicial"], ["OTHER_EXPENSE", "Outra despesa"],
  ["ACCOUNT_RECEIPT", "Recebimento de conta"], ["REVERSED_WITHDRAWAL", "Sangria reversa"],
  ["OTHER_INCOME", "Outra entrada"]
] as const;

export default function FinanceManagePage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [payables, setPayables] = useState<Account[]>([]);
  const [receivables, setReceivables] = useState<Account[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [dateFrom, setDateFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [operatorId, setOperatorId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [opening, setOpening] = useState({ amount: "0", notes: "" });
  const [movement, setMovement] = useState({ category: "WITHDRAWAL", amount: "", reason: "", description: "" });
  const [closing, setClosing] = useState({ amount: "", justification: "" });
  const [payable, setPayable] = useState({ description: "", category: "Fornecedor", amount: "", dueDate: "", notes: "" });
  const [receivable, setReceivable] = useState({ customerName: "", description: "", amount: "", dueDate: "", notes: "" });
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = localStorage.getItem("delivery:token");
    if (!token) throw new Error("Sessão expirada");
    const response = await apiFetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      cache: "no-store"
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message ?? "Falha na operação");
    }
    return response.status === 204 ? undefined as T : response.json();
  }

  async function load() {
    try {
      const query = new URLSearchParams({
        dateFrom, dateTo,
        ...(operatorId ? { operatorId } : {}),
        ...(paymentMethod ? { paymentMethod } : {})
      }).toString();
      const me = await request<{ permissions: string[] }>("/admin/me");
      const allowed = (permission: string) => me.permissions.includes("*") || me.permissions.includes(permission);
      setPermissions(me.permissions);
      if (!allowed("FINANCE") && allowed("CASH_MANAGE")) setTab("cash");
      const [sum, dash, payableRows, receivableRows, sessionRows, auditRows] = await Promise.all([
        request<Summary>("/admin/finance/summary"),
        allowed("FINANCE") ? request<Dashboard>("/admin/finance/dashboard") : Promise.resolve(null),
        allowed("FINANCE") ? request<Account[]>("/admin/finance/payables") : Promise.resolve([]),
        allowed("FINANCE") ? request<Account[]>("/admin/finance/receivables") : Promise.resolve([]),
        request<Session[]>(`/admin/finance/sessions?${query}`),
        allowed("AUDIT_VIEW") ? request<Audit[]>(`/admin/finance/audit?${query}`) : Promise.resolve([])
      ]);
      setSummary(sum); setDashboard(dash as Dashboard | null); setPayables(payableRows); setReceivables(receivableRows);
      setSessions(sessionRows); setAudits(auditRows);
      if (sum.totals) setClosing((value) => ({ ...value, amount: sum.totals!.expectedCash.toFixed(2) }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar financeiro");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [dateFrom, dateTo, operatorId, paymentMethod]);

  async function action(path: string, body?: unknown, method = "POST", success = "Operação realizada") {
    try {
      await request(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      toast.success(success); await load(); return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na operação"); return false;
    }
  }

  const maxDaily = Math.max(1, ...(dashboard?.daily.map((item) => item.sales) ?? [1]));
  const maxMonthly = Math.max(1, ...(dashboard?.monthly.map((item) => item.sales) ?? [1]));
  const paymentTotal = Object.values(dashboard?.paymentMethods ?? {}).reduce((sum, value) => sum + value, 0) || 1;
  const filteredEntries = useMemo(() => summary?.history.filter((entry) => !entry.deletedAt) ?? [], [summary]);
  const can = (permission: string) => permissions.includes("*") || permissions.includes(permission);
  const operators = useMemo(
    () => Array.from(new Map(sessions.filter((item) => item.operatorName).map((item) => [item.openedBy, { id: item.openedBy, name: item.operatorName! }])).values()),
    [sessions]
  );

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[.2em] text-ember">Gestão e auditoria</p>
          <h1 className="font-display text-4xl md:text-5xl">Financeiro profissional</h1>
        </div>
        <Link href="/admin" className="rounded-xl bg-ink px-4 py-2 text-white">Voltar ao painel</Link>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {([
          ["dashboard", "Painel"], ["cash", "Caixa"], ["payables", "Contas a pagar"],
          ["receivables", "Contas a receber"], ["history", "Fechamentos"], ["audit", "Auditoria"]
        ] as Array<[Tab, string]>).filter(([value]) => {
          if (value === "cash" || value === "history") return can("CASH_MANAGE") || can("FINANCE");
          if (value === "payables" || value === "receivables") return can("FINANCE");
          if (value === "audit") return can("AUDIT_VIEW");
          return can("FINANCE");
        }).map(([value, label]) => (
          <button key={value} onClick={() => setTab(value)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === value ? "bg-ember text-white" : "border bg-white/70"}`}>
            {label}
          </button>
        ))}
      </div>

      <section className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border bg-white/80 p-3">
        <label className="text-xs font-semibold">Data inicial<input className="mt-1 block rounded-lg border px-3 py-2" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="text-xs font-semibold">Data final<input className="mt-1 block rounded-lg border px-3 py-2" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <label className="text-xs font-semibold">Operador<select className="mt-1 block rounded-lg border px-3 py-2" value={operatorId} onChange={(e) => setOperatorId(e.target.value)}><option value="">Todos</option>{operators.map((operator) => <option key={operator.id} value={operator.id}>{operator.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Pagamento<select className="mt-1 block rounded-lg border px-3 py-2" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="">Todos</option><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="MERCADO_PAGO">Mercado Pago</option></select></label>
        {can("FINANCE_REPORTS") && <><a className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/finance.xlsx?dateFrom=${dateFrom}&dateTo=${dateTo}&operatorId=${operatorId}&paymentMethod=${paymentMethod}&token=${typeof window !== "undefined" ? localStorage.getItem("delivery:token") : ""}`} target="_blank">Excel</a>
        <a className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/finance.pdf?dateFrom=${dateFrom}&dateTo=${dateTo}&operatorId=${operatorId}&paymentMethod=${paymentMethod}&token=${typeof window !== "undefined" ? localStorage.getItem("delivery:token") : ""}`} target="_blank">PDF</a></>}
      </section>

      {loading ? <p className="mt-8">Carregando módulo financeiro...</p> : null}

      {!loading && tab === "dashboard" && dashboard && (
        <>
          <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Metric label="Faturamento hoje" value={BRL.format(dashboard.revenueToday)} tone="green" />
            <Metric label="Faturamento semana" value={BRL.format(dashboard.revenueWeek)} />
            <Metric label="Faturamento mês" value={BRL.format(dashboard.revenueMonth)} />
            <Metric label="Ticket médio" value={BRL.format(dashboard.averageTicket)} />
            <Metric label="Pedidos hoje" value={dashboard.ordersToday} />
            <Metric label="Lucro estimado" value={BRL.format(dashboard.estimatedProfit)} tone={dashboard.estimatedProfit >= 0 ? "green" : "red"} />
            <Metric label="Despesas hoje" value={BRL.format(dashboard.expensesToday)} tone="red" />
            <Metric label="Despesas mês" value={BRL.format(dashboard.expensesMonth)} tone="red" />
            <Metric label="Saldo atual" value={BRL.format(dashboard.currentBalance)} tone={dashboard.currentBalance >= 0 ? "green" : "red"} />
            <Metric label="Caixas abertos" value={dashboard.openCashRegisters} />
            <Metric label="Caixas fechados" value={dashboard.closedCashRegisters} />
            <Metric label="Contas vencidas" value={dashboard.overduePayables} tone={dashboard.overduePayables ? "red" : "green"} />
          </section>
          <section className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border bg-white/85 p-5">
              <h2 className="font-bold">Vendas nos últimos 7 dias</h2>
              <div className="mt-6 flex h-56 items-end gap-3">
                {dashboard.daily.map((item) => (
                  <div key={item.date} className="flex flex-1 flex-col items-center gap-2">
                    <span className="text-[10px] font-semibold">{BRL.format(item.sales)}</span>
                    <div className="w-full rounded-t-lg bg-gradient-to-t from-ember to-orange-300" style={{ height: `${Math.max(4, item.sales / maxDaily * 170)}px` }} />
                    <span className="text-[10px]">{new Date(`${item.date}T12:00`).toLocaleDateString("pt-BR", { weekday: "short" })}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border bg-white/85 p-5">
              <h2 className="font-bold">Formas de pagamento</h2>
              <div className="mt-5 space-y-4">
                {Object.entries(dashboard.paymentMethods).map(([method, amount]) => (
                  <div key={method}>
                    <div className="mb-1 flex justify-between text-sm"><span>{method}</span><strong>{BRL.format(amount)}</strong></div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-ink" style={{ width: `${amount / paymentTotal * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="mt-5 rounded-2xl border bg-white/85 p-5">
            <h2 className="font-bold">Evolução financeira mensal</h2>
            <div className="mt-6 flex h-60 items-end gap-4">
              {dashboard.monthly.map((item) => (
                <div key={item.month} className="flex flex-1 flex-col items-center gap-2">
                  <span className="text-[10px] font-semibold">{BRL.format(item.sales)}</span>
                  <div className="w-full rounded-t-xl bg-gradient-to-t from-ink to-blue-400" style={{ height: `${Math.max(5, item.sales / maxMonthly * 180)}px` }} />
                  <span className="text-xs">{new Date(`${item.month}-02T12:00`).toLocaleDateString("pt-BR", { month: "short" })}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {!loading && tab === "cash" && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
          <div className="space-y-5">
            {!summary?.session ? (
              <Panel title="Abertura de caixa">
                <p className="text-sm opacity-70">Operador, horário, IP e dispositivo serão registrados automaticamente.</p>
                <Field label="Valor inicial"><input className="input" type="number" step="0.01" value={opening.amount} onChange={(e) => setOpening({ ...opening, amount: e.target.value })} /></Field>
                <Field label="Observações"><textarea className="input" value={opening.notes} onChange={(e) => setOpening({ ...opening, notes: e.target.value })} /></Field>
                <button className="btn-primary" onClick={() => void action("/admin/finance/open", { openingAmount: Number(opening.amount), notes: opening.notes }, "POST", "Caixa aberto com auditoria")}>Abrir caixa</button>
              </Panel>
            ) : (
              <>
                <Panel title={`Caixa de ${summary.session.operatorName}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label="Abertura" value={BRL.format(summary.session.openingAmount)} />
                    <Metric label="Esperado" value={BRL.format(summary.totals?.expectedCash ?? 0)} tone="green" />
                    <Metric label="Dinheiro" value={BRL.format(summary.totals?.cash ?? 0)} />
                    <Metric label="PIX" value={BRL.format(summary.totals?.pix ?? 0)} />
                    <Metric label="Crédito" value={BRL.format(summary.totals?.credit ?? 0)} />
                    <Metric label="Débito" value={BRL.format(summary.totals?.debit ?? 0)} />
                  </div>
                  <p className="mt-3 text-xs opacity-60">Aberto em {new Date(summary.session.openedAt).toLocaleString("pt-BR")}</p>
                </Panel>
                <Panel title="Fechamento">
                  <Field label="Valor contado"><input className="input" type="number" step="0.01" value={closing.amount} onChange={(e) => setClosing({ ...closing, amount: e.target.value })} /></Field>
                  <p className={`text-sm font-semibold ${Number(closing.amount) - (summary.totals?.expectedCash ?? 0) === 0 ? "text-emerald-700" : "text-red-600"}`}>
                    Diferença: {BRL.format(Number(closing.amount || 0) - (summary.totals?.expectedCash ?? 0))}
                  </p>
                  <Field label="Justificativa da divergência"><textarea className="input" value={closing.justification} onChange={(e) => setClosing({ ...closing, justification: e.target.value })} /></Field>
                  <button className="w-full rounded-xl bg-red-700 px-4 py-3 font-bold text-white" onClick={() => void action("/admin/finance/close", { closingAmount: Number(closing.amount), justification: closing.justification }, "POST", "Caixa fechado e bloqueado")}>Fechar caixa</button>
                </Panel>
              </>
            )}
          </div>
          <div className="space-y-5">
            {summary?.session && (
              <Panel title="Nova movimentação">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Tipo"><select className="input" value={movement.category} onChange={(e) => setMovement({ ...movement, category: e.target.value })}>{entryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  <Field label="Valor"><input className="input" type="number" step="0.01" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} /></Field>
                  <Field label="Motivo"><input className="input" value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} /></Field>
                  <Field label="Observação"><input className="input" value={movement.description} onChange={(e) => setMovement({ ...movement, description: e.target.value })} /></Field>
                </div>
                <button className="btn-primary" onClick={async () => {
                  if (await action("/admin/finance/entry", { ...movement, amount: Number(movement.amount) }, "POST", "Movimentação auditada")) setMovement({ category: "WITHDRAWAL", amount: "", reason: "", description: "" });
                }}>Registrar movimentação</button>
              </Panel>
            )}
            <Panel title="Movimentações do caixa">
              <div className="max-h-[600px] space-y-2 overflow-auto">
                {filteredEntries.map((entry) => (
                  <article key={entry.id} className="rounded-xl border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div><strong>{entry.reason || entry.category}</strong><p className="text-xs opacity-60">{entry.description || entry.orderCode ? `Pedido #${entry.orderCode}` : "Sem observação"}</p></div>
                      <strong className={entry.direction === "IN" ? "text-emerald-700" : "text-red-600"}>{entry.direction === "IN" ? "+" : "-"} {BRL.format(entry.amount)}</strong>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs opacity-60"><span>{entry.operatorName}</span><span>{new Date(entry.createdAt).toLocaleString("pt-BR")}</span></div>
                    {!entry.orderCode && !["OPENING", "CLOSING"].includes(entry.category ?? "") && (
                      <button className="mt-2 text-xs font-semibold text-red-600" onClick={() => {
                        const reason = prompt("Motivo da exclusão lógica:");
                        if (reason) void action(`/admin/finance/entry/${entry.id}`, { reason }, "DELETE", "Movimentação arquivada");
                      }}>Arquivar lançamento</button>
                    )}
                  </article>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {!loading && tab === "payables" && (
        <AccountsPanel title="Contas a pagar" rows={payables} form={
          <>
            <Field label="Descrição"><input className="input" value={payable.description} onChange={(e) => setPayable({ ...payable, description: e.target.value })} /></Field>
            <Field label="Categoria"><input className="input" value={payable.category} onChange={(e) => setPayable({ ...payable, category: e.target.value })} /></Field>
            <Field label="Valor"><input className="input" type="number" value={payable.amount} onChange={(e) => setPayable({ ...payable, amount: e.target.value })} /></Field>
            <Field label="Vencimento"><input className="input" type="date" value={payable.dueDate} onChange={(e) => setPayable({ ...payable, dueDate: e.target.value })} /></Field>
            <button className="btn-primary" onClick={() => void action("/admin/finance/payables", { ...payable, amount: Number(payable.amount), dueDate: payable.dueDate }, "POST", "Conta cadastrada")}>Cadastrar</button>
          </>
        } actionLabel="Pagar" onAction={(id) => void action(`/admin/finance/payables/${id}/pay`, undefined, "POST", "Conta paga e lançada no caixa")} />
      )}

      {!loading && tab === "receivables" && (
        <AccountsPanel title="Contas a receber" rows={receivables} form={
          <>
            <Field label="Cliente"><input className="input" value={receivable.customerName} onChange={(e) => setReceivable({ ...receivable, customerName: e.target.value })} /></Field>
            <Field label="Descrição"><input className="input" value={receivable.description} onChange={(e) => setReceivable({ ...receivable, description: e.target.value })} /></Field>
            <Field label="Valor"><input className="input" type="number" value={receivable.amount} onChange={(e) => setReceivable({ ...receivable, amount: e.target.value })} /></Field>
            <Field label="Vencimento"><input className="input" type="date" value={receivable.dueDate} onChange={(e) => setReceivable({ ...receivable, dueDate: e.target.value })} /></Field>
            <button className="btn-primary" onClick={() => void action("/admin/finance/receivables", { ...receivable, amount: Number(receivable.amount), dueDate: receivable.dueDate }, "POST", "Recebimento cadastrado")}>Cadastrar</button>
          </>
        } actionLabel="Receber" onAction={(id) => void action(`/admin/finance/receivables/${id}/receive`, undefined, "POST", "Recebimento lançado no caixa")} />
      )}

      {!loading && tab === "history" && (
        <Panel title="Histórico de caixas">
          <div className="space-y-3">
            {sessions.map((session) => (
              <article key={session.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <div><strong>{session.operatorName || "Operador"}</strong><p className="text-xs opacity-60">{new Date(session.openedAt).toLocaleString("pt-BR")} {session.closedAt ? `até ${new Date(session.closedAt).toLocaleString("pt-BR")}` : "• ABERTO"}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${session.closedAt ? "bg-slate-100" : "bg-emerald-100 text-emerald-700"}`}>{session.closedAt ? "Fechado" : "Aberto"}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Metric label="Abertura" value={BRL.format(session.openingAmount)} />
                  <Metric label="Vendas" value={BRL.format(session.totals.totalSales)} />
                  <Metric label="Despesas" value={BRL.format(session.totals.expenses)} />
                  <Metric label="Esperado" value={BRL.format(session.expectedAmount ?? session.totals.expectedCash)} />
                  <Metric label="Diferença" value={BRL.format(session.difference ?? 0)} tone={(session.difference ?? 0) === 0 ? "green" : "red"} />
                </div>
                {session.closedAt && <button className="mt-3 rounded-lg border px-3 py-2 text-xs font-bold" onClick={() => {
                  const reason = prompt("Justificativa obrigatória para reabrir o caixa:");
                  if (reason) void action(`/admin/finance/sessions/${session.id}/reopen`, { reason }, "POST", "Caixa reaberto com auditoria");
                }}>Reabrir caixa</button>}
              </article>
            ))}
          </div>
        </Panel>
      )}

      {!loading && tab === "audit" && (
        <Panel title="Trilha de auditoria">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead><tr className="border-b"><th className="p-2">Data</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>IP</th><th>Alteração</th></tr></thead>
              <tbody>{audits.map((item) => <tr key={item.id} className="border-b align-top"><td className="p-2">{new Date(item.createdAt).toLocaleString("pt-BR")}</td><td>{item.userName || "-"}</td><td className="font-semibold">{item.action}</td><td>{item.entity} {item.entityId?.slice(-8)}</td><td>{item.ipAddress || "-"}</td><td><details><summary className="cursor-pointer">Ver dados</summary><pre className="max-w-sm overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ anterior: item.oldValue, novo: item.newValue }, null, 2)}</pre></details></td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border bg-white/85 p-5 shadow-sm"><h2 className="mb-4 text-xl font-bold">{title}</h2>{children}</section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mb-3 block text-sm font-semibold">{label}{children}</label>;
}
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "red" }) {
  return <article className="rounded-xl border bg-white/80 p-3"><p className="text-xs opacity-60">{label}</p><p className={`mt-1 font-bold ${tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-600" : ""}`}>{value}</p></article>;
}
function AccountsPanel({ title, rows, form, actionLabel, onAction }: { title: string; rows: Account[]; form: React.ReactNode; actionLabel: string; onAction: (id: string) => void }) {
  return <div className="mt-5 grid gap-5 lg:grid-cols-[.7fr_1.3fr]"><Panel title={`Nova • ${title}`}>{form}</Panel><Panel title={title}><div className="space-y-2">{rows.map((row) => <article key={row.id} className="rounded-xl border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{row.description || row.customerName}</strong><p className="text-xs opacity-60">{row.category || row.description} • vence {new Date(row.dueDate).toLocaleDateString("pt-BR")}</p></div><strong>{BRL.format(row.amount)}</strong></div><div className="mt-2 flex items-center justify-between"><span className={`rounded-full px-2 py-1 text-xs font-bold ${row.effectiveStatus === "OVERDUE" ? "bg-red-100 text-red-700" : row.status === "PAID" || row.status === "RECEIVED" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{row.effectiveStatus}</span>{!["PAID", "RECEIVED"].includes(row.status) && <button className="rounded-lg bg-ink px-3 py-1.5 text-xs text-white" onClick={() => onAction(row.id)}>{actionLabel}</button>}</div></article>)}</div></Panel></div>;
}
