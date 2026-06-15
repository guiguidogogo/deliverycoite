"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../lib/api";

type StaffAccount = {
  name: string;
  email: string;
  phone?: string | null;
  role: "ADMIN" | "MANAGER" | "ATTENDANT";
  staffRole?: { name: string } | null;
};

export default function AdminAccountPage() {
  const [account, setAccount] = useState<StaffAccount | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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

  useEffect(() => {
    void request("/admin/me")
      .then(setAccount)
      .catch((error) => toast.error(error instanceof Error ? error.message : "Falha ao carregar conta"));
  }, []);

  async function saveAccount() {
    if (!account) return;
    try {
      const updated = await request("/admin/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: account.name,
          email: account.email,
          phone: account.phone?.trim() || null
        })
      });
      setAccount(updated);
      toast.success("Dados atualizados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar dados");
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      toast.error("A confirmacao da nova senha esta diferente");
      return;
    }
    try {
      await request("/admin/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Senha alterada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar senha");
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-4xl">Minha Conta</h1>
        <Link href="/admin" className="rounded-xl bg-ink px-3 py-2 text-white">Voltar</Link>
      </div>

      <section className="mt-4 rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Dados administrativos</h2>
        {account && (
          <div className="mt-3 grid gap-3">
            <input className="rounded-xl border px-3 py-2" placeholder="Nome" value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} />
            <input className="rounded-xl border px-3 py-2" type="email" placeholder="Email de acesso" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} />
            <input className="rounded-xl border px-3 py-2" placeholder="WhatsApp para recuperar senha" value={account.phone ?? ""} onChange={(event) => setAccount({ ...account, phone: event.target.value })} />
            <p className="text-sm opacity-70">
              Acesso: {account.role === "ADMIN" ? "Administrador total" : account.staffRole?.name || account.role}
            </p>
            <button className="rounded-xl bg-ember px-3 py-2 text-white" onClick={() => void saveAccount()}>
              Salvar dados
            </button>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Trocar senha</h2>
        <div className="mt-3 grid gap-3">
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Senha atual" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Nova senha (minimo 6 caracteres)" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
          <input className="rounded-xl border px-3 py-2" type="password" placeholder="Confirmar nova senha" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <button className="rounded-xl bg-ink px-3 py-2 text-white" onClick={() => void changePassword()}>
            Alterar senha
          </button>
        </div>
      </section>
    </main>
  );
}
