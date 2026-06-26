"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../lib/api";

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "hubregional.com.br";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [masterAccess, setMasterAccess] = useState(false);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    setMasterAccess(host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === `admin.${ROOT_DOMAIN}`);
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ...(subdomain.trim() ? { subdomain: subdomain.trim().toLowerCase() } : {})
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.message ?? "Credenciais inválidas");
      return;
    }

    const payload = await res.json();
    localStorage.setItem("delivery:token", payload.token);
    localStorage.setItem("delivery:admin-user", JSON.stringify(payload.user));
    if (payload.user.company?.subdomain) {
      localStorage.setItem("delivery:subdomain", payload.user.company.subdomain);
    } else {
      localStorage.removeItem("delivery:subdomain");
    }
    router.push(payload.user.role === "SUPER_ADMIN" ? "/admin/companies" : "/admin");
  }

  async function requestReset() {
    const res = await fetch(`${API_URL}/auth/password/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(payload.message ?? "Falha ao enviar codigo");
    setRecovering(true);
    toast.success(payload.message);
  }

  async function resetPassword() {
    const res = await fetch(`${API_URL}/auth/password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, newPassword })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(payload.message ?? "Falha ao redefinir senha");
    setRecovering(false);
    setCode("");
    setPassword("");
    toast.success("Senha alterada. Entre com a nova senha.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h1 className="font-display text-4xl">{masterAccess ? "Painel Master SaaS" : "Login Administrativo"}</h1>
        <p className="text-sm opacity-70">
          {masterAccess ? "Acesso global para gerenciamento das empresas" : "Administrador / Atendente"}
        </p>

        <div className="mt-4 space-y-3">
          <input className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {!masterAccess && (
            <>
              <input
                className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
                placeholder="Subdomínio da empresa (opcional)"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              />
              <p className="text-xs opacity-60">
                Preencha apenas se o mesmo email estiver cadastrado em mais de uma empresa.
              </p>
            </>
          )}
          <button className="w-full rounded-xl bg-ink px-4 py-2 font-semibold text-white dark:bg-ember" type="submit">
            Entrar
          </button>
          {!recovering ? (
            <button type="button" className="w-full text-sm underline" onClick={() => void requestReset()}>
              Esqueci minha senha
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-black/10 p-3 dark:border-white/20">
              <p className="text-sm font-semibold">Código enviado ao WhatsApp cadastrado</p>
              <input className="w-full rounded-xl border px-3 py-2" placeholder="Código de 6 dígitos" value={code} onChange={(e) => setCode(e.target.value)} />
              <input className="w-full rounded-xl border px-3 py-2" type="password" placeholder="Nova senha" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button type="button" className="w-full rounded-xl bg-ember px-3 py-2 text-white" onClick={() => void resetPassword()}>
                Redefinir senha
              </button>
            </div>
          )}
        </div>
      </form>
    </main>
  );
}
