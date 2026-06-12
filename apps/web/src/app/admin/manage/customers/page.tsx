"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  number: string;
  district: string;
  complement?: string | null;
  _count: {
    orders: number;
    addresses: number;
  };
};

export default function CustomersManagePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/customers?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });

    if (!res.ok) {
      toast.error("Falha ao carregar clientes");
      return;
    }

    setCustomers(await res.json());
  }

  useEffect(() => {
    void load();
  }, [search]);

  async function saveCustomer() {
    if (!editing) return;
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/customers/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: editing.name,
        phone: editing.phone,
        email: editing.email || null,
        address: editing.address,
        number: editing.number,
        district: editing.district,
        complement: editing.complement || null
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.message ?? "Falha ao atualizar cliente");
      return;
    }

    toast.success("Cliente atualizado");
    setEditing(null);
    await load();
  }

  async function removeCustomer(id: string) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    if (!window.confirm("Deseja realmente apagar este cliente e seus pedidos?")) return;

    const res = await fetch(`${API_URL}/admin/customers/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.message ?? "Falha ao apagar cliente");
      return;
    }

    toast.success("Cliente apagado");
    setCustomers((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Clientes Cadastrados</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <input
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          placeholder="Buscar por nome, telefone ou email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      <section className="mt-4 space-y-2">
        {customers.map((customer) => (
          <article key={customer.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{customer.name}</p>
                <p className="text-sm opacity-70">{customer.phone} {customer.email ? `| ${customer.email}` : ""}</p>
                <p className="text-xs opacity-70">
                  {customer.address}, {customer.number} - {customer.district}
                </p>
                <p className="text-xs opacity-60">Pedidos: {customer._count.orders} | Enderecos: {customer._count.addresses}</p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                  onClick={() => setEditing(customer)}
                >
                  Editar
                </button>
                <button className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void removeCustomer(customer.id)}>
                  Apagar
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>

      {editing && (
        <section className="fixed inset-0 z-30 bg-black/50 p-3" onClick={() => setEditing(null)}>
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-semibold">Editar Cliente</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.name} onChange={(e) => setEditing((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="Nome" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.phone} onChange={(e) => setEditing((v) => (v ? { ...v, phone: e.target.value } : v))} placeholder="Telefone" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" value={editing.email ?? ""} onChange={(e) => setEditing((v) => (v ? { ...v, email: e.target.value } : v))} placeholder="Email" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.address} onChange={(e) => setEditing((v) => (v ? { ...v, address: e.target.value } : v))} placeholder="Endereco" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.number} onChange={(e) => setEditing((v) => (v ? { ...v, number: e.target.value } : v))} placeholder="Numero" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.district} onChange={(e) => setEditing((v) => (v ? { ...v, district: e.target.value } : v))} placeholder="Bairro" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.complement ?? ""} onChange={(e) => setEditing((v) => (v ? { ...v, complement: e.target.value } : v))} placeholder="Complemento" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-black/20 px-3 py-2 text-sm dark:border-white/20" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="rounded-lg bg-ember px-3 py-2 text-sm text-white" onClick={() => void saveCustomer()}>
                Salvar
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
