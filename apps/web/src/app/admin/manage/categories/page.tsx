"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch, readApiJson } from "../../../../lib/api";

type Category = { id: string; name: string; description?: string; active: boolean };

export default function CategoriesManagePage() {
  const router = useRouter();
  const [items, setItems] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingActive, setEditingActive] = useState(true);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return;
    }

    const res = await apiFetch(`/admin/categories`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("delivery:token");
        window.location.href = "/admin/login";
        return;
      }
      toast.error("Nao foi possivel carregar as categorias");
      return;
    }

    setItems(await readApiJson<Category[]>(res));
  }

  useEffect(() => {
    void load();
  }, []);

  async function createCategory() {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return;
    }

    const res = await apiFetch(`/admin/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, active: true })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("delivery:token");
        window.location.href = "/admin/login";
        return;
      }
      const payload = await readApiJson<any>(res).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao criar categoria");
      return;
    }

    setName("");
    await load();
    toast.success("Categoria criada com sucesso");
  }

  function startEdit(item: Category) {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditingActive(item.active);
  }

  async function saveEdit(id: string) {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return;
    }

    const res = await apiFetch(`/admin/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: editingName.trim(), active: editingActive })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("delivery:token");
        window.location.href = "/admin/login";
        return;
      }
      const payload = await readApiJson<any>(res).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao atualizar categoria");
      return;
    }

    setEditingId(null);
    await load();
    toast.success("Categoria atualizada");
  }

  async function deleteCategory(id: string) {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return;
    }

    const confirmed = window.confirm("Deseja realmente excluir esta categoria?");
    if (!confirmed) return;

    const res = await apiFetch(`/admin/categories/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("delivery:token");
        window.location.href = "/admin/login";
        return;
      }
      const payload = await readApiJson<any>(res).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao excluir categoria");
      return;
    }

    await load();
    toast.success("Categoria removida");
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-4xl">Gestao de Categorias</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex gap-2">
          <input className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="rounded-xl bg-ember px-4 py-2 text-white" onClick={() => void createCategory()}>
            Criar
          </button>
        </div>
      </section>

      <section className="mt-4 space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            {editingId === item.id ? (
              <div className="space-y-3">
                <input
                  className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingActive} onChange={(e) => setEditingActive(e.target.checked)} />
                  Categoria ativa
                </label>
                <div className="flex gap-2">
                  <button className="rounded-xl bg-ember px-3 py-2 text-sm text-white" onClick={() => void saveEdit(item.id)}>
                    Salvar
                  </button>
                  <button className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/20" onClick={() => setEditingId(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-xs opacity-70">{item.active ? "Ativa" : "Inativa"}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-xl bg-ink px-3 py-2 text-sm text-white" onClick={() => startEdit(item)}>
                    Editar
                  </button>
                  <button className="rounded-xl bg-rose-600 px-3 py-2 text-sm text-white" onClick={() => void deleteCategory(item.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
