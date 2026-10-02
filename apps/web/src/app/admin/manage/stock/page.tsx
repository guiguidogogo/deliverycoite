"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";

type Product = { id: string; name: string; active: boolean; available: boolean; trackStock: boolean; stockQuantity: number; lowStockAlert?: number | null };

export default function StockManagePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("delivery:token") || "" : "";

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const response = await apiFetch("/admin/products", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Não foi possível carregar o estoque.");
      setProducts(data.map((item: Product) => ({ ...item, stockQuantity: Number(item.stockQuantity || 0), lowStockAlert: item.lowStockAlert == null ? null : Number(item.lowStockAlert) })));
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar o estoque."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function status(item: Product) {
    if (!item.trackStock) return "not-tracked";
    if (item.stockQuantity <= 0) return "out";
    if (item.lowStockAlert != null && item.stockQuantity <= item.lowStockAlert) return "low";
    return "ok";
  }

  async function update(item: Product, quantity: number, alert: number | null) {
    setSaving(item.id);
    try {
      const response = await apiFetch(`/admin/products/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ trackStock: true, stockQuantity: Math.max(0, quantity), lowStockAlert: alert == null || Number.isNaN(alert) ? null : Math.max(0, alert) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Não foi possível atualizar o estoque.");
      setProducts((current) => current.map((entry) => entry.id === item.id ? { ...entry, trackStock: true, stockQuantity: Math.max(0, quantity), lowStockAlert: alert } : entry));
      toast.success(`${item.name}: estoque atualizado`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao atualizar estoque."); }
    finally { setSaving(null); }
  }

  const visible = useMemo(() => products.filter((item) => filter === "all" || status(item) === filter), [products, filter]);
  const tracked = products.filter((item) => item.trackStock);
  const out = tracked.filter((item) => status(item) === "out").length;
  const low = tracked.filter((item) => status(item) === "low").length;

  return <main className="mx-auto w-full max-w-6xl px-4 pb-12">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Operação</p><h1 className="text-3xl font-black text-slate-900">Controle de estoque</h1><p className="mt-1 text-sm text-slate-500">Acompanhe produtos próximos do fim e evite vender itens esgotados.</p></div><button className="rounded-xl border px-4 py-2 font-bold" onClick={() => void load()}>Atualizar</button></div>
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><button className={`rounded-2xl border p-4 text-left ${filter === "all" ? "border-emerald-600 bg-emerald-50" : "bg-white"}`} onClick={() => setFilter("all")}><span className="text-sm text-slate-500">Produtos controlados</span><b className="mt-1 block text-2xl">{tracked.length}</b></button><button className={`rounded-2xl border p-4 text-left ${filter === "low" ? "border-amber-500 bg-amber-50" : "bg-white"}`} onClick={() => setFilter("low")}><span className="text-sm text-slate-500">Estoque baixo</span><b className="mt-1 block text-2xl text-amber-700">{low}</b></button><button className={`rounded-2xl border p-4 text-left ${filter === "out" ? "border-red-500 bg-red-50" : "bg-white"}`} onClick={() => setFilter("out")}><span className="text-sm text-slate-500">Esgotados</span><b className="mt-1 block text-2xl text-red-700">{out}</b></button></div>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="grid grid-cols-[minmax(0,1fr)_115px_115px_100px] gap-3 border-b bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500"><span>Produto</span><span>Estoque</span><span>Alerta</span><span>Status</span></div>{loading ? <p className="p-8 text-center text-slate-500">Carregando estoque…</p> : visible.length ? visible.map((item) => { const current = status(item); return <div key={item.id} className="grid items-center gap-3 border-b px-4 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_115px_115px_100px]"><div className="min-w-0"><b className="block truncate">{item.name}</b>{!item.trackStock && <span className="text-xs text-slate-400">Controle desativado</span>}</div><input aria-label={`Estoque de ${item.name}`} className="w-full rounded-lg border px-2 py-2" type="number" min="0" step="1" defaultValue={item.stockQuantity} onBlur={(event) => { const quantity = Number(event.currentTarget.value); if (quantity !== item.stockQuantity) void update(item, quantity, item.lowStockAlert ?? null); }} /><input aria-label={`Alerta de ${item.name}`} className="w-full rounded-lg border px-2 py-2" type="number" min="0" step="1" defaultValue={item.lowStockAlert ?? 0} onBlur={(event) => { const alert = Number(event.currentTarget.value); if (alert !== (item.lowStockAlert ?? 0)) void update(item, item.stockQuantity, alert); }} /><span className={`justify-self-start rounded-full px-2 py-1 text-xs font-bold ${current === "out" ? "bg-red-100 text-red-700" : current === "low" ? "bg-amber-100 text-amber-700" : current === "ok" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{saving === item.id ? "Salvando…" : current === "out" ? "Esgotado" : current === "low" ? "Baixo" : current === "ok" ? "Normal" : "Não controlado"}</span></div>; }) : <p className="p-8 text-center text-slate-500">Nenhum produto nesta categoria.</p>}</section>
  </main>;
}
