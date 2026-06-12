"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_URL } from "../../../../lib/api";

type Product = { id: string; name: string; price: number; categoryId: string; active: boolean; available: boolean };
type Category = { id: string; name: string };

async function readJsonResponse(res: Response) {
  const text = await res.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text);
  }
}

export default function ProductsManagePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: "", description: "", price: "", categoryId: "", imageUrl: "" });
  const [imageFile, setImageFile] = useState<File | null>(null);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    try {
      const [productsRes, categoriesRes] = await Promise.all([
        fetch(`${API_URL}/admin/products`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/admin/categories`, { headers: { Authorization: `Bearer ${token}` } })
      ]);

      if (!productsRes.ok || !categoriesRes.ok) {
        const [productsError, categoriesError] = await Promise.all([
          readJsonResponse(productsRes),
          readJsonResponse(categoriesRes)
        ]);

        throw new Error(
          (productsError as { message?: string } | null)?.message
            ?? (categoriesError as { message?: string } | null)?.message
            ?? "Falha ao carregar produtos ou categorias"
        );
      }

      const p = await readJsonResponse(productsRes);
      const c = await readJsonResponse(categoriesRes);

      setProducts((p ?? []).map((item: any) => ({ ...item, price: Number(item.price) })));
      setCategories(c ?? []);
    } catch (error) {
      console.error("Erro ao carregar produtos", error);
      alert(error instanceof Error ? error.message : "Falha ao carregar produtos");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createProduct() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    try {
      let imageUrl = form.imageUrl;
      if (imageFile) {
        const fileData = new FormData();
        fileData.append("image", imageFile);

        const uploadRes = await fetch(`${API_URL}/admin/uploads/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fileData
        });

        if (!uploadRes.ok) {
          const uploadError = await readJsonResponse(uploadRes);
          throw new Error((uploadError as { message?: string } | null)?.message ?? "Falha no upload da imagem");
        }

        const uploadPayload = await readJsonResponse(uploadRes);
        imageUrl = `${API_URL.replace(/\/api$/, "")}${uploadPayload.url}`;
      }

      const createRes = await fetch(`${API_URL}/admin/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...form,
          imageUrl: imageUrl || undefined,
          price: Number(form.price),
          active: true,
          available: true
        })
      });

      if (!createRes.ok) {
        const createError = await readJsonResponse(createRes);
        throw new Error((createError as { message?: string } | null)?.message ?? "Falha ao criar produto");
      }

      setForm({ name: "", description: "", price: "", categoryId: "", imageUrl: "" });
      setImageFile(null);
      await load();
    } catch (error) {
      console.error("Erro ao criar produto", error);
      alert(error instanceof Error ? error.message : "Falha ao criar produto");
    }
  }

  async function toggleProduct(product: Product) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ active: !product.active, available: !product.available })
      });

      if (!res.ok) {
        const error = await readJsonResponse(res);
        throw new Error((error as { message?: string } | null)?.message ?? "Falha ao atualizar produto");
      }

      await load();
    } catch (error) {
      console.error("Erro ao atualizar produto", error);
      alert(error instanceof Error ? error.message : "Falha ao atualizar produto");
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-4xl">Gestao de Produtos</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="font-semibold">Novo Produto</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Nome" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Preco" value={form.price} onChange={(e) => setForm((v) => ({ ...v, price: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Descricao" value={form.description} onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="URL da imagem" value={form.imageUrl} onChange={(e) => setForm((v) => ({ ...v, imageUrl: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
          <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={form.categoryId} onChange={(e) => setForm((v) => ({ ...v, categoryId: e.target.value }))}>
            <option value="">Categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button className="rounded-xl bg-ember px-3 py-2 text-white" onClick={() => void createProduct()}>
            Criar
          </button>
        </div>
      </section>

      <section className="mt-4 space-y-2">
        {products.map((product) => (
          <article key={product.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{product.name}</p>
                <p className="text-sm opacity-70">R$ {product.price.toFixed(2)}</p>
              </div>
              <button className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20" onClick={() => void toggleProduct(product)}>
                {product.active ? "Desativar" : "Ativar"}
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
