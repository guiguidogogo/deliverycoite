"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@delivery.com");
  const [password, setPassword] = useState("123456");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
      toast.error("Credenciais invalidas");
      return;
    }

    const payload = await res.json();
    localStorage.setItem("delivery:token", payload.token);
    router.push("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h1 className="font-display text-4xl">Admin Login</h1>
        <p className="text-sm opacity-70">Administrador / Atendente</p>

        <div className="mt-4 space-y-3">
          <input className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="w-full rounded-xl bg-ink px-4 py-2 font-semibold text-white dark:bg-ember" type="submit">
            Entrar
          </button>
        </div>
      </form>
    </main>
  );
}
