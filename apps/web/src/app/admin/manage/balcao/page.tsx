"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { adminApi, type AdminUser } from "../../../../lib/admin-api";
import { apiFetch, readApiJson } from "../../../../lib/api";
import type { Product } from "../../../../lib/types";

type CatalogProduct = Product & { active: boolean; available: boolean; trackStock?: boolean; stockQuantity?: number; category?: { id: string; name: string } };
type Line = { id: string; product: CatalogProduct; quantity: number; complements: { complementId: string; quantity: number }[] };
type Method = "CASH" | "PIX" | "DEBIT" | "CREDIT";
type Payload = { requestId: string; customerName: string; notes: string; method: Method; paid: boolean; changeFor?: number; expectedTotal: number; items: { productId: string; quantity: number; complements: Line["complements"] }[] };
type Saved = { orderId: string; orderNumber: number; total: number; paid: boolean };
const money = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const unitPrice = (line: Line) => Number(line.product.promoPrice ?? line.product.price) + line.complements.reduce((sum, c) => sum + Number(line.product.complements.find(link => link.complementId === c.complementId)?.complement.price ?? 0) * c.quantity, 0);

export default function CounterPage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Method>("PIX");
  const [paid, setPaid] = useState(false);
  const [received, setReceived] = useState("");
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Payload | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [customizing, setCustomizing] = useState<CatalogProduct | null>(null);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const storageKey = useRef("");
  const sending = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const total = Math.round(lines.reduce((sum, line) => sum + unitPrice(line) * line.quantity, 0) * 100) / 100;
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const categories = useMemo(() => Array.from(new Map(products.filter(p => p.category).map(p => [p.category!.id, p.category!])).values()), [products]);
  const filtered = products.filter(p => p.active && p.available && (!category || p.categoryId === category) && normalize(p.name).includes(normalize(query)));
  const locked = busy || Boolean(pending);

  async function loadCatalog() {
    const data = await adminApi<CatalogProduct[]>("/admin/counter/products");
    setProducts(data);
    setLines(current => current.map(line => ({ ...line, product: data.find(p => p.id === line.product.id) ?? line.product })));
  }
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const me = await adminApi<AdminUser>("/admin/me");
        if (!mounted) return;
        if (!["SUPER_ADMIN", "ADMIN"].includes(me.role) && !me.permissions.includes("ORDERS")) throw new Error("Seu usuário não tem permissão para criar pedidos.");
        storageKey.current = `delivery:counter:${me.company?.id}:${me.id}`;
        const draft = sessionStorage.getItem(storageKey.current);
        if (draft) {
          try {
            const d = JSON.parse(draft);
            setLines(d.lines ?? []); setName(d.name ?? ""); setNotes(d.notes ?? ""); setMethod(d.method ?? "PIX"); setPaid(Boolean(d.paid)); setReceived(d.received ?? ""); setPending(d.pending ?? null);
          } catch { sessionStorage.removeItem(storageKey.current); }
        }
        setAllowed(true);
        await loadCatalog();
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : "Não foi possível carregar o catálogo."); }
      finally { if (mounted) setLoading(false); }
    })();
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!loading && storageKey.current) sessionStorage.setItem(storageKey.current, JSON.stringify({ lines, name, notes, method, paid, received, pending }));
  }, [lines, name, notes, method, paid, received, pending, loading]);
  useEffect(() => { if (customizing) dialog.current?.showModal(); }, [customizing]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (lines.length || pending) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [lines.length, pending]);

  function add(product: CatalogProduct, complements: Line["complements"] = []) {
    const key = JSON.stringify([product.id, [...complements].sort((a, b) => a.complementId.localeCompare(b.complementId))]);
    setLines(current => current.some(line => line.id === key)
      ? current.map(line => line.id === key ? { ...line, quantity: Math.min(999, line.quantity + 1) } : line)
      : [...current, { id: key, product, quantity: 1, complements }]);
    setSaved(null); setError("");
  }
  function pick(product: CatalogProduct) {
    if (product.complements.some(link => link.complement.active)) {
      setChoices(Object.fromEntries(product.complements.filter(l => l.required && l.complement.active).map(l => [l.complementId, 1])));
      setCustomizing(product);
    } else add(product);
  }
  async function submit() {
    if (sending.current || (!lines.length && !pending)) return;
    const amount = received.trim() ? Number(received.replace(",", ".")) : undefined;
    if (!pending && method === "CASH" && amount !== undefined && (!Number.isFinite(amount) || amount < total)) { setError("Informe um valor recebido igual ou maior que o total."); return; }
    const payload: Payload = pending ?? { requestId: crypto.randomUUID(), customerName: name, notes, method, paid, expectedTotal: total, ...(method === "CASH" && amount !== undefined ? { changeFor: amount } : {}), items: lines.map(line => ({ productId: line.product.id, quantity: line.quantity, complements: line.complements })) };
    sending.current = true; setBusy(true); setError(""); setPending(payload);
    // Persist before the network request so refreshing after a timeout is safe.
    sessionStorage.setItem(storageKey.current, JSON.stringify({ lines, name, notes, method, paid, received, pending: payload }));
    try {
      const response = await apiFetch("/admin/counter/orders", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("delivery:token")}` }, body: JSON.stringify(payload) }, { skipSubdomain: true });
      const data = await readApiJson<Saved & { message?: string }>(response);
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) setPending(null);
        throw new Error(data.message ?? "Não foi possível registrar o pedido.");
      }
      setSaved(data); setLines([]); setName(""); setNotes(""); setReceived(""); setPending(null); setPaid(false);
      search.current?.focus();
      void loadCatalog().catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : "Conexão interrompida. Tente confirmar novamente; o mesmo pedido não será duplicado."); }
    finally { sending.current = false; setBusy(false); }
  }

  if (loading) return <main className="p-6" role="status">Carregando balcão…</main>;
  return <main className="mx-auto max-w-7xl p-4 md:p-6 text-slate-800">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Atendimento presencial</p><h1 className="font-display text-4xl">Balcão · Pedido rápido</h1><p className="mt-1 text-sm text-slate-500">Escolha os produtos e envie o pedido, sem mesa ou cadastro.</p></div>
      <a href="/admin" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Voltar ao painel</a>
    </header>
    {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {saved && <div role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-100 p-4"><strong>Pedido #{saved.orderNumber} enviado!</strong> Total {money(Number(saved.total))} · {saved.paid ? "Pagamento registrado no caixa." : "Pagamento pendente."} O pedido está disponível para a cozinha e para o Print Agent.</div>}
    {allowed && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 rounded-2xl border border-emerald-100 bg-white p-4">
        <div className="flex gap-2"><label className="flex-1"><span className="sr-only">Buscar produto</span><input ref={search} autoFocus className="w-full rounded-xl border bg-slate-50 px-4 py-3" placeholder="Buscar produto pelo nome…" value={query} onChange={e => setQuery(e.target.value)} /></label><button type="button" disabled={locked} onClick={() => { setError(""); void loadCatalog().catch(e => setError(e.message)); }} className="rounded-xl border px-3 text-sm disabled:opacity-40">Atualizar</button></div>
        <div className="my-4 flex flex-wrap gap-2" aria-label="Categorias">{[{ id: "", name: "Todos" }, ...categories].map(c => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={`rounded-full px-4 py-2 text-sm font-bold ${category === c.id ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-600"}`}>{c.name}</button>)}</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{filtered.map(product => {
          const out = product.trackStock && Number(product.stockQuantity) <= 0;
          return <button key={product.id} type="button" disabled={locked || out} onClick={() => pick(product)} className="flex min-h-32 flex-col justify-between gap-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-40"><span className="font-bold leading-snug">{product.name}</span><span className="flex flex-wrap items-center justify-between gap-2"><strong className="text-emerald-800">{money(Number(product.promoPrice ?? product.price))}</strong><span className="text-xs text-slate-500">{out ? "Esgotado" : product.complements.some(l => l.complement.active) ? "Escolher +" : "Adicionar +"}</span></span></button>;
        })}</div>
        {!filtered.length && <p className="py-16 text-center text-slate-500">Nenhum produto encontrado. Tente outro nome ou categoria.</p>}
      </section>
      <section className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm xl:sticky xl:top-4">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold">Pedido atual</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800">{count} {count === 1 ? "item" : "itens"}</span></div>
        {!lines.length && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Toque em um produto para começar.</p>}
        <div className="max-h-80 overflow-y-auto">{lines.map(line => <div key={line.id} className="border-b py-3"><div className="flex justify-between gap-2"><strong className="text-sm">{line.product.name}</strong><strong className="whitespace-nowrap text-sm">{money(unitPrice(line) * line.quantity)}</strong></div>{line.complements.map(c => <p key={c.complementId} className="mt-1 text-xs text-slate-500">+ {c.quantity}× {line.product.complements.find(l => l.complementId === c.complementId)?.complement.name}</p>)}<div className="mt-2 flex items-center gap-3"><button aria-label={`Diminuir ${line.product.name}`} disabled={locked} className="h-9 w-9 rounded-lg border" onClick={() => setLines(current => current.flatMap(l => l.id !== line.id ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : []))}>−</button><span aria-label="Quantidade">{line.quantity}</span><button aria-label={`Aumentar ${line.product.name}`} disabled={locked || line.quantity >= 999} className="h-9 w-9 rounded-lg border" onClick={() => setLines(current => current.map(l => l.id === line.id ? { ...l, quantity: l.quantity + 1 } : l))}>+</button><button disabled={locked} className="ml-auto text-xs text-red-700" onClick={() => setLines(current => current.filter(l => l.id !== line.id))}>Remover</button></div></div>)}</div>
        <fieldset disabled={locked} className="mt-4 space-y-3 disabled:opacity-60">
          <label className="block text-sm font-semibold">Nome para chamar <span className="font-normal text-slate-400">(opcional)</span><input maxLength={100} value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex.: João" /></label>
          <label className="block text-sm font-semibold">Observações <textarea maxLength={1000} rows={2} value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full rounded-xl border p-3 font-normal" placeholder="Ex.: X-búrguer sem cebola" /></label>
          <label className="block text-sm font-semibold">Forma de pagamento<select value={method} onChange={e => setMethod(e.target.value as Method)} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="PIX">Pix</option><option value="CASH">Dinheiro</option><option value="DEBIT">Cartão de débito</option><option value="CREDIT">Cartão de crédito</option></select></label>
          <div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={!paid} onClick={() => setPaid(false)} className={`rounded-xl border p-3 text-sm font-bold ${!paid ? "border-emerald-600 bg-emerald-50 text-emerald-800" : ""}`}>Pagar depois</button><button type="button" aria-pressed={paid} onClick={() => setPaid(true)} className={`rounded-xl border p-3 text-sm font-bold ${paid ? "border-emerald-600 bg-emerald-50 text-emerald-800" : ""}`}>Já recebi</button></div>
          {paid && <p className="text-xs text-slate-500">Confirme somente após receber o pagamento. É necessário ter seu caixa aberto.</p>}
          {method === "CASH" && <label className="block text-sm font-semibold">Valor recebido / troco para<input inputMode="decimal" value={received} onChange={e => setReceived(e.target.value)} className="mt-1 w-full rounded-xl border p-3" placeholder="Opcional, ex.: 50,00" />{received && Number.isFinite(Number(received.replace(",", "."))) && <span className="mt-1 block text-emerald-700">Troco: {money(Math.max(0, Number(received.replace(",", ".")) - total))}</span>}</label>}
        </fieldset>
        <div className="my-4 flex items-center justify-between border-t pt-4"><span className="font-bold">Total <small className="block font-normal text-slate-400">Balcão · sem frete</small></span><strong className="text-3xl text-emerald-800">{money(total)}</strong></div>
        {pending && !busy && <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">A confirmação ficou pendente. Tente novamente para consultar ou concluir este mesmo pedido, sem duplicá-lo.</p>}
        <button disabled={busy || (!lines.length && !pending)} onClick={() => void submit()} className="w-full rounded-xl bg-emerald-700 px-4 py-4 font-bold text-white disabled:opacity-40">{busy ? "Registrando pedido…" : pending ? "Confirmar envio pendente" : paid ? "Registrar pagamento e enviar" : "Enviar pedido"}</button>
      </section>
    </div>}
    {customizing && <dialog ref={dialog} onCancel={() => setCustomizing(null)} className="w-[min(95vw,480px)] rounded-2xl p-5 shadow-xl backdrop:bg-slate-950/50"><h2 className="text-xl font-bold">{customizing.name}</h2><p className="mt-1 text-sm text-slate-500">Escolha os complementos por unidade.</p><div className="my-4 max-h-[55vh] space-y-3 overflow-y-auto">{customizing.complements.filter(l => l.complement.active).map(link => <label key={link.complementId} className="flex items-center justify-between gap-3 rounded-xl border p-3"><span className="text-sm font-bold">{link.complement.name}<small className="block font-normal text-slate-500">{money(Number(link.complement.price))}{link.required ? " · obrigatório" : ""}</small></span><select aria-label={`Quantidade de ${link.complement.name}`} className="rounded-lg border p-2" value={choices[link.complementId] ?? 0} onChange={e => setChoices(c => ({ ...c, [link.complementId]: Number(e.target.value) }))}>{Array.from({ length: link.required ? 20 : 21 }, (_, i) => i + (link.required ? 1 : 0)).map(n => <option key={n} value={n}>{n}</option>)}</select></label>)}</div><div className="flex gap-2"><button className="flex-1 rounded-xl border p-3" onClick={() => setCustomizing(null)}>Cancelar</button><button className="flex-1 rounded-xl bg-emerald-700 p-3 font-bold text-white" onClick={() => { add(customizing, Object.entries(choices).filter(([, quantity]) => quantity > 0).map(([complementId, quantity]) => ({ complementId, quantity }))); setCustomizing(null); }}>Adicionar ao pedido</button></div></dialog>}
  </main>;
}
