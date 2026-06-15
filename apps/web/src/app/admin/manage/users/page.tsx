"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

const permissionOptions = [
  ["ORDERS", "Pedidos"],
  ["CATALOG", "Produtos, categorias e complementos"],
  ["CUSTOMERS", "Clientes"],
  ["COUPONS", "Cupons e banner"],
  ["REPORTS", "Relatorios"],
  ["FINANCE", "Visualizar financeiro"],
  ["CASH_MANAGE", "Abrir, movimentar e fechar caixa"],
  ["SETTINGS", "Configuracoes"],
  ["USERS", "Usuarios e perfis"],
  ["STORE_PAUSE", "Pausar e reabrir loja"]
] as const;

type StaffRole = { id: string; name: string; permissions: string[] };
type StaffUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: "ADMIN" | "MANAGER" | "ATTENDANT";
  active: boolean;
  staffRole?: StaffRole | null;
};

export default function UsersManagePage() {
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roleName, setRoleName] = useState("");
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const [user, setUser] = useState({
    name: "", email: "", phone: "", password: "", role: "ATTENDANT", staffRoleId: ""
  });

  async function request(path: string, init?: RequestInit) {
    const token = localStorage.getItem("delivery:token");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message ?? "Falha na requisicao");
    return payload;
  }

  async function load() {
    try {
      const [loadedRoles, loadedUsers] = await Promise.all([
        request("/admin/staff/roles"),
        request("/admin/staff/users")
      ]);
      setRoles(loadedRoles);
      setUsers(loadedUsers);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar usuarios");
    }
  }

  useEffect(() => { void load(); }, []);

  async function createRole() {
    try {
      await request("/admin/staff/roles", {
        method: "POST",
        body: JSON.stringify({ name: roleName, permissions: rolePermissions })
      });
      setRoleName("");
      setRolePermissions([]);
      toast.success("Perfil criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar perfil");
    }
  }

  async function createUser() {
    try {
      await request("/admin/staff/users", {
        method: "POST",
        body: JSON.stringify({
          ...user,
          role: user.role,
          staffRoleId: user.role === "ADMIN" ? null : user.staffRoleId
        })
      });
      setUser({ name: "", email: "", phone: "", password: "", role: "ATTENDANT", staffRoleId: "" });
      toast.success("Usuario criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar usuario");
    }
  }

  async function toggleUser(item: StaffUser) {
    try {
      await request(`/admin/staff/users/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !item.active })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar usuario");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl">Usuarios e Acessos</h1>
        <Link href="/admin" className="rounded-xl bg-ink px-3 py-2 text-white">Voltar</Link>
      </div>

      <section className="mt-4 rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Novo perfil de acesso</h2>
        <input className="mt-3 w-full rounded-xl border px-3 py-2" placeholder="Nome: Gerente, Funcionario..." value={roleName} onChange={(e) => setRoleName(e.target.value)} />
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {permissionOptions.map(([permission, label]) => (
            <label key={permission} className="flex items-center gap-2 rounded-xl border p-2">
              <input
                type="checkbox"
                checked={rolePermissions.includes(permission)}
                onChange={(e) => setRolePermissions((current) =>
                  e.target.checked ? [...current, permission] : current.filter((item) => item !== permission)
                )}
              />
              {label}
            </label>
          ))}
        </div>
        <button className="mt-3 w-full rounded-xl bg-ember px-3 py-2 text-white" onClick={() => void createRole()}>
          Criar perfil
        </button>
      </section>

      <section className="mt-4 rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Novo usuario administrativo</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input className="rounded-xl border px-3 py-2" placeholder="Nome" value={user.name} onChange={(e) => setUser((v) => ({ ...v, name: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2" type="email" placeholder="Email" value={user.email} onChange={(e) => setUser((v) => ({ ...v, email: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2" placeholder="WhatsApp para recuperar senha" value={user.phone} onChange={(e) => setUser((v) => ({ ...v, phone: e.target.value }))} />
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Senha inicial" value={user.password} onChange={(e) => setUser((v) => ({ ...v, password: e.target.value }))} />
          <select className="rounded-xl border px-3 py-2" value={user.role} onChange={(e) => setUser((v) => ({ ...v, role: e.target.value }))}>
            <option value="ATTENDANT">Funcionario</option>
            <option value="MANAGER">Gerente</option>
            <option value="ADMIN">Administrador total</option>
          </select>
          {user.role !== "ADMIN" && (
            <select className="rounded-xl border px-3 py-2" value={user.staffRoleId} onChange={(e) => setUser((v) => ({ ...v, staffRoleId: e.target.value }))}>
              <option value="">Escolha o perfil de acesso</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          )}
        </div>
        <button className="mt-3 w-full rounded-xl bg-ink px-3 py-2 text-white" onClick={() => void createUser()}>
          Criar usuario
        </button>
      </section>

      <section className="mt-4 rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Perfis cadastrados</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {roles.map((role) => (
            <article key={role.id} className="rounded-xl border p-3">
              <p className="font-semibold">{role.name}</p>
              <p className="mt-1 text-sm opacity-70">
                {role.permissions.map((permission) =>
                  permissionOptions.find(([value]) => value === permission)?.[1] ?? permission
                ).join(", ") || "Sem permissoes"}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-4 space-y-2">
        {users.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white/80 p-3 dark:bg-slate-900/70">
            <div>
              <p className="font-semibold">{item.name}</p>
              <p className="text-sm opacity-70">{item.email} | {item.phone || "WhatsApp nao cadastrado"}</p>
              <p className="text-xs">{item.role === "ADMIN" ? "Administrador total" : item.staffRole?.name || item.role}</p>
            </div>
            <button className={`rounded-lg px-3 py-2 text-sm text-white ${item.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void toggleUser(item)}>
              {item.active ? "Desativar" : "Ativar"}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
