"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../../../../lib/api";

type Order = {
  id: string;
  status: "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FINISHED" | "CANCELED";
  total: string;
  createdAt: string;
  customer: { name: string; phone: string };
};

function toInputDate(value: Date) {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ReportsManagePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [dateFrom, setDateFrom] = useState(() => toInputDate(new Date()));
  const [dateTo, setDateTo] = useState(() => toInputDate(new Date()));

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/orders?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });

    if (!res.ok) return;
    setOrders(await res.json());
  }

  useEffect(() => {
    void load();
  }, [dateFrom, dateTo]);

  const summary = useMemo(() => {
    const paid = orders.filter((order) => order.status === "DELIVERED" || order.status === "FINISHED");
    const canceled = orders.filter((order) => order.status === "CANCELED");
    const totalPaid = paid.reduce((acc, order) => acc + Number(order.total), 0);

    return {
      totalOrders: orders.length,
      paidOrders: paid.length,
      canceledOrders: canceled.length,
      totalPaid
    };
  }, [orders]);

  const token = typeof window !== "undefined" ? localStorage.getItem("delivery:token") : null;

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Relatorio de Pedidos</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap gap-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <a className="rounded-xl bg-ink px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/orders.xlsx?dateFrom=${dateFrom}&dateTo=${dateTo}&token=${token ?? ""}`} target="_blank" rel="noreferrer">
            Exportar Excel
          </a>
          <a className="rounded-xl bg-ember px-3 py-2 text-sm text-white" href={`${API_URL}/admin/reports/orders.pdf?dateFrom=${dateFrom}&dateTo=${dateTo}&token=${token ?? ""}`} target="_blank" rel="noreferrer">
            Exportar PDF
          </a>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric title="Pedidos" value={summary.totalOrders} />
        <Metric title="Concluidos" value={summary.paidOrders} />
        <Metric title="Cancelados" value={summary.canceledOrders} />
        <Metric title="Faturamento" value={`R$ ${summary.totalPaid.toFixed(2)}`} />
      </section>

      <section className="mt-4 space-y-2">
        {orders.map((order) => (
          <article key={order.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>
                <strong>{order.customer.name}</strong> - {order.customer.phone}
              </p>
              <p>{new Date(order.createdAt).toLocaleString("pt-BR")}</p>
              <p>{order.status}</p>
              <p className="font-semibold">R$ {Number(order.total).toFixed(2)}</p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string | number }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white/85 p-3 dark:border-white/10 dark:bg-slate-900/70">
      <p className="text-xs opacity-70">{title}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </article>
  );
}
