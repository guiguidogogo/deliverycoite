"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

type Category = { id: string; name: string };
type Complement = { id: string; name: string; price: number; active: boolean };
type LinkConfig = { complementId: string; required: boolean; sortOrder: number };
type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  promoPrice?: number | null;
  imageUrl?: string | null;
  categoryId: string;
  active: boolean;
  available: boolean;
  complements: Array<LinkConfig & { complement: Complement }>;
};

const emptyForm = {
  name: "",
  description: "",
  price: "",
  promoPrice: "",
  categoryId: "",
  imageUrl: "",
  active: true,
  available: true
};

async function responseJson(res: Response) {
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(payload?.message ?? "Erro na requisicao");
  return payload;
}

export default function ProductsManagePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [complements, setComplements] = useState<Complement[]>([]);
  const [links, setLinks] = useState<LinkConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [productsRes, categoriesRes, complementsRes] = await Promise.all([
      fetch(`${API_URL}/admin/products`, { headers, cache: "no-store" }),
      fetch(`${API_URL}/admin/categories`, { headers, cache: "no-store" }),
      fetch(`${API_URL}/admin/complements`, { headers, cache: "no-store" })
    ]);
    const [productData, categoryData, complementData] = await Promise.all([
      responseJson(productsRes),
      responseJson(categoriesRes),
      responseJson(complementsRes)
    ]);
    setProducts(productData.map((item: any) => ({
      ...item,
      price: Number(item.price),
      promoPrice: item.promoPrice ? Number(item.promoPrice) : null
    })));
    setCategories(categoryData);
    setComplements(complementData.map((item: any) => ({ ...item, price: Number(item.price) })));
  }

  useEffect(() => {
    void load().catch((error) => toast.error(error.message));
  }, []);

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setLinks([]);
    setImageFile(null);
  }

  function edit(product: Product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      promoPrice: product.promoPrice ? String(product.promoPrice) : "",
      categoryId: product.categoryId,
      imageUrl: product.imageUrl ?? "",
      active: product.active,
      available: product.available
    });
    setLinks(product.complements.map((link, index) => ({
      complementId: link.complementId,
      required: link.required,
      sortOrder: link.sortOrder ?? index
    })));
    setImageFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleComplement(complementId: string) {
    setLinks((current) =>
      current.some((link) => link.complementId === complementId)
        ? current.filter((link) => link.complementId !== complementId)
        : [...current, { complementId, required: false, sortOrder: current.length }]
    );
  }

  function toggleRequired(complementId: string) {
    setLinks((current) =>
      current.map((link) =>
        link.complementId === complementId ? { ...link, required: !link.required } : link
      )
    );
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
        editingId ? `${API_URL}/admin/products/${editingId}` : `${API_URL}/admin/products`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...form,
            price: Number(form.price),
            promoPrice: form.promoPrice ? Number(form.promoPrice) : null,
            imageUrl,
            complementLinks: links
          })
        }
      );
      await responseJson(res);
      toast.success(editingId ? "Produto atualizado" : "Produto criado");
      reset();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar produto");
    } finally {
      setSaving(false);
    }
  }

  async function remove(product: Product) {
    if (!window.confirm(`Apagar o produto ${product.name}?`)) return;
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/admin/products/${product.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      await responseJson(res);
      toast.success("Produto apagado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao apagar produto");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Gestao de Produtos</h1>
        <div className="flex gap-2">
          <Link className="rounded-lg bg-ember px-3 py-2 text-sm text-white" href="/admin/manage/complements">Complementos</Link>
          <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">Voltar</Link>
        </div>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="font-semibold">{editingId ? "Editar produto" : "Novo produto"}</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900" placeholder="Nome" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
          <select className="rounded-xl border px-3 py-2 dark:bg-slate-900" value={form.categoryId} onChange={(e) => setForm((v) => ({ ...v, categoryId: e.target.value }))}>
            <option value="">Categoria</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900" type="number" min="0.01" step="0.01" placeholder="Preco" value={form.price} onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900" type="number" min="0.01" step="0.01" placeholder="Preco promocional (opcional)" value={form.promoPrice} onChange={(e) => setForm((v) => ({ ...v, promoPrice: e.target.value }))} />
          <textarea className="rounded-xl border px-3 py-2 dark:bg-slate-900 md:col-span-2" placeholder="Descricao" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 dark:bg-slate-900 md:col-span-2" type="url" placeholder="URL da imagem" value={form.imageUrl} onChange={(e) => setForm((v) => ({ ...v, imageUrl: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2 md:col-span-2" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2"><input type="checkbox" checked={form.active} onChange={(e) => setForm((v) => ({ ...v, active: e.target.checked }))} /> Ativo</label>
          <label className="flex items-center gap-2 rounded-xl border px-3 py-2"><input type="checkbox" checked={form.available} onChange={(e) => setForm((v) => ({ ...v, available: e.target.checked }))} /> Disponivel</label>
        </div>

        <div className="mt-4">
          <p className="font-semibold">Complementos disponiveis</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {complements.map((complement) => {
              const selected = links.find((link) => link.complementId === complement.id);
              return (
                <div key={complement.id} className={`rounded-xl border p-3 ${selected ? "border-ember" : "border-black/10"}`}>
                  <label className="flex items-center justify-between gap-2">
                    <span><input className="mr-2" type="checkbox" checked={Boolean(selected)} onChange={() => toggleComplement(complement.id)} />{complement.name}</span>
                    <span className="text-sm">+ R$ {complement.price.toFixed(2)}</span>
                  </label>
                  {selected && (
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected.required} onChange={() => toggleRequired(complement.id)} />
                      Obrigatorio
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button className="rounded-xl bg-ember px-5 py-2 text-white disabled:opacity-60" disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando..." : editingId ? "Atualizar produto" : "Criar produto"}
          </button>
          {editingId && <button className="rounded-xl border px-4 py-2" onClick={reset}>Cancelar</button>}
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        {products.map((product) => (
          <article key={product.id} className="flex gap-3 rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-black/5">
              {product.imageUrl ? <Image src={product.imageUrl} alt={product.name} fill unoptimized className="object-cover" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{product.name}</p>
              <p className="text-sm opacity-70">R$ {product.price.toFixed(2)}</p>
              <p className="text-xs opacity-60">{product.complements.length} complemento(s)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="rounded-lg border px-2 py-1 text-xs" onClick={() => edit(product)}>Editar</button>
                <button className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void remove(product)}>Apagar</button>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
