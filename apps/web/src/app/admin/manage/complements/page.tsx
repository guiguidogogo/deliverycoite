"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

type Complement = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string | null;
  active: boolean;
};

const emptyForm = {
  name: "",
  description: "",
  price: "0",
  imageUrl: "",
  active: true
};

async function responseJson(res: Response) {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message ?? "Erro na requisicao");
  return payload;
}

export default function ComplementsManagePage() {
  const [items, setItems] = useState<Complement[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    const res = await fetch(`${API_URL}/admin/complements`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const data = await responseJson(res);
    setItems(data.map((item: any) => ({ ...item, price: Number(item.price) })));
  }

  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
  }, []);

  function edit(item: Complement) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description,
      price: String(item.price),
      imageUrl: item.imageUrl ?? "",
      active: item.active
    });
    setImageFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setImageFile(null);
  }

  async function upload(token: string) {
    if (!imageFile) return form.imageUrl || null;
    const data = new FormData();
    data.append("image", imageFile);
    const res = await fetch(`${API_URL}/admin/uploads/image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: data
    });
    const payload = await responseJson(res);
    return payload.absoluteUrl ?? `${window.location.origin}${payload.url}`;
  }

  async function save() {
    const token = localStorage.getItem("delivery:token");
    if (!token || saving) return;
    setSaving(true);
    try {
      const imageUrl = await upload(token);
      const res = await fetch(
        editingId ? `${API_URL}/admin/complements/${editingId}` : `${API_URL}/admin/complements`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...form,
            price: Number(form.price),
            imageUrl
          })
        }
      );
      await responseJson(res);
      toast.success(editingId ? "Complemento atualizado" : "Complemento criado");
      reset();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar complemento");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Complement) {
    if (!window.confirm(`Apagar o complemento ${item.name}?`)) return;
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/admin/complements/${item.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      await responseJson(res);
      toast.success("Complemento apagado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao apagar complemento");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Complementos</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">Voltar</Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="font-semibold">{editingId ? "Editar complemento" : "Novo complemento"}</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900" placeholder="Nome" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900" type="number" min="0" step="0.01" placeholder="Preco adicional" value={form.price} onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900 md:col-span-2" placeholder="Descricao" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900 md:col-span-2" placeholder="URL da imagem" value={form.imageUrl} onChange={(e) => setForm((v) => ({ ...v, imageUrl: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 md:col-span-2" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((v) => ({ ...v, active: e.target.checked }))} />
            Ativo
          </label>
          <div className="flex gap-2">
            <button className="flex-1 rounded-xl bg-ember px-3 py-2 text-white disabled:opacity-60" disabled={saving} onClick={() => void save()}>
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Criar"}
            </button>
            {editingId && <button className="rounded-xl border px-3 py-2" onClick={reset}>Cancelar</button>}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="flex gap-3 rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-black/5">
              {item.imageUrl ? <Image src={item.imageUrl} alt={item.name} fill unoptimized className="object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-2">
                <p className="font-semibold">{item.name}</p>
                <span className={`text-xs ${item.active ? "text-emerald-600" : "text-red-600"}`}>{item.active ? "Ativo" : "Inativo"}</span>
              </div>
              <p className="text-sm opacity-70">{item.description}</p>
              <p className="font-semibold text-ember">+ R$ {item.price.toFixed(2)}</p>
              <div className="mt-2 flex gap-2">
                <button className="rounded-lg border px-2 py-1 text-xs" onClick={() => edit(item)}>Editar</button>
                <button className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void remove(item)}>Apagar</button>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
