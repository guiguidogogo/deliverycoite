"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../../../../lib/admin-api";

type Raffle = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  prize?: string | null;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "ENDED" | "CANCELLED" | "FINISHED";
  startsAt?: string | null;
  endsAt?: string | null;
  totalNumbers: number;
  pricePerNumber: number;
  minimumQuantity: number;
  maximumQuantity: number;
  featuredImageUrl?: string | null;
  _count?: { numbers: number; orders: number; participants: number };
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const initialForm = {
  title: "",
  description: "",
  regulation: "",
  prize: "",
  status: "DRAFT",
  startsAt: "",
  endsAt: "",
  numberStart: 0,
  numberEnd: 99,
  numberDigits: 2,
  pricePerNumber: 1,
  minimumQuantity: 1,
  maximumQuantity: 10,
  featuredImageUrl: "",
  videoUrl: ""
};

export default function AdminRafflesPage() {
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const totalNumbers = useMemo(() => Math.max(0, Number(form.numberEnd) - Number(form.numberStart) + 1), [form.numberEnd, form.numberStart]);

  async function load() {
    setLoading(true);
    try {
      setRaffles(await adminApi<Raffle[]>("/admin/raffles"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar rifas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (totalNumbers <= 0) {
      toast.error("Revise a numeracao da rifa");
      return;
    }
    setSaving(true);
    try {
      await adminApi("/admin/raffles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
          endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null
        })
      });
      toast.success("Rifa criada com numeros disponiveis");
      setForm(initialForm);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar rifa");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(id: string, status: Raffle["status"]) {
    try {
      await adminApi(`/admin/raffles/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      toast.success("Status atualizado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar status");
    }
  }

  const update = (field: keyof typeof initialForm, value: string | number) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-ember">Sorteios e campanhas</p>
          <h1 className="font-display text-4xl">Rifas</h1>
          <p className="mt-1 text-sm opacity-70">Modulo proprio para campanhas numeradas, reservas e sorteios.</p>
        </div>
        <Link className="rounded-xl bg-ink px-4 py-2 font-bold text-white" href="/admin">Voltar</Link>
      </div>

      <section className="mt-6 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <form onSubmit={submit} className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
          <h2 className="text-2xl font-bold">Nova rifa</h2>
          <div className="mt-4 grid gap-3">
            <Field label="Titulo"><input className="input" required value={form.title} onChange={(e) => update("title", e.target.value)} /></Field>
            <Field label="Premio"><input className="input" value={form.prize} onChange={(e) => update("prize", e.target.value)} /></Field>
            <Field label="Descricao"><textarea className="input min-h-24" value={form.description} onChange={(e) => update("description", e.target.value)} /></Field>
            <Field label="Regulamento"><textarea className="input min-h-28" value={form.regulation} onChange={(e) => update("regulation", e.target.value)} /></Field>
            <Field label="Imagem principal"><input className="input" placeholder="https://..." value={form.featuredImageUrl} onChange={(e) => update("featuredImageUrl", e.target.value)} /></Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Inicio"><input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} /></Field>
              <Field label="Encerramento"><input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} /></Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Numero inicial"><input className="input" type="number" min={0} value={form.numberStart} onChange={(e) => update("numberStart", Number(e.target.value))} /></Field>
              <Field label="Numero final"><input className="input" type="number" min={1} value={form.numberEnd} onChange={(e) => update("numberEnd", Number(e.target.value))} /></Field>
              <Field label="Digitos"><input className="input" type="number" min={1} max={8} value={form.numberDigits} onChange={(e) => update("numberDigits", Number(e.target.value))} /></Field>
            </div>
            <p className="rounded-2xl bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
              Serao criados <strong>{totalNumbers}</strong> numeros. Exemplo: {String(form.numberStart).padStart(Number(form.numberDigits), "0")}
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Valor por numero"><input className="input" type="number" min={0.01} step="0.01" value={form.pricePerNumber} onChange={(e) => update("pricePerNumber", Number(e.target.value))} /></Field>
              <Field label="Minimo por compra"><input className="input" type="number" min={1} value={form.minimumQuantity} onChange={(e) => update("minimumQuantity", Number(e.target.value))} /></Field>
              <Field label="Maximo por compra"><input className="input" type="number" min={1} value={form.maximumQuantity} onChange={(e) => update("maximumQuantity", Number(e.target.value))} /></Field>
            </div>
            <Field label="Status inicial">
              <select className="input" value={form.status} onChange={(e) => update("status", e.target.value)}>
                <option value="DRAFT">Rascunho</option>
                <option value="SCHEDULED">Agendada</option>
                <option value="ACTIVE">Ativa</option>
                <option value="PAUSED">Pausada</option>
              </select>
            </Field>
          </div>
          <button disabled={saving} className="mt-5 w-full rounded-2xl bg-ember px-4 py-3 font-bold text-white disabled:opacity-60">
            {saving ? "Criando..." : "Criar rifa"}
          </button>
        </form>

        <section className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold">Campanhas</h2>
            <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void load()}>Atualizar</button>
          </div>
          <div className="mt-4 space-y-3">
            {loading && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Carregando...</p>}
            {!loading && raffles.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm opacity-70">Nenhuma rifa cadastrada.</p>}
            {raffles.map((raffle) => (
              <article key={raffle.id} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.25em] text-ember">{raffle.status}</p>
                    <h3 className="text-xl font-bold">{raffle.title}</h3>
                    <p className="text-sm opacity-70">{raffle.prize || "Premio nao informado"}</p>
                    <p className="mt-1 text-xs opacity-60">{raffle.totalNumbers} numeros • {BRL.format(raffle.pricePerNumber)} por numero • {raffle._count?.orders ?? 0} pedido(s)</p>
                  </div>
                  <strong className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-700">{raffle._count?.numbers ?? raffle.totalNumbers} nums</strong>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {raffle.status !== "ACTIVE" && <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white" onClick={() => void changeStatus(raffle.id, "ACTIVE")}>Publicar</button>}
                  {raffle.status === "ACTIVE" && <button className="rounded-xl bg-amber-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void changeStatus(raffle.id, "PAUSED")}>Pausar</button>}
                  <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void changeStatus(raffle.id, "FINISHED")}>Finalizar</button>
                  <span className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-800">/rifas/{raffle.slug}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
    </label>
  );
}
