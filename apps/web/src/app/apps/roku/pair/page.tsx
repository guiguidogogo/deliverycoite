"use client";

import { useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../../../lib/api";

type PairingInfo = { status: string; expiresAt: string; registered?: boolean; message?: string };

export default function RokuPairPage() {
  const [code, setCode] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registered, setRegistered] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "success" | "error">("loading");
  const [message, setMessage] = useState("Verificando o codigo da TV...");

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("code")?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
    setCode(value);
    if (!value) {
      setStatus("error");
      setMessage("Informe o codigo exibido na TV.");
      return;
    }
    void apiFetch(`/pairings/${encodeURIComponent(value)}`, { cache: "no-store" }, { skipSubdomain: true })
      .then(async (response) => {
        const payload = await readApiJson<PairingInfo>(response);
        if (!response.ok) throw new Error(payload.message ?? "Codigo nao encontrado");
        if (payload.status === "expired") throw new Error("O codigo expirou. Gere um novo codigo na TV.");
        if (payload.status !== "pending") throw new Error("Este codigo ja foi utilizado.");
        setRegistered(Boolean(payload.registered));
        setStatus("ready");
        setMessage(payload.registered ? "Esta Roku ja esta ativa. Informe os novos dados da lista IPTV." : "Informe seu codigo de acesso e os dados da lista IPTV.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Nao foi possivel verificar o codigo");
      });
  }, []);

  async function activate() {
    setStatus("loading");
    setMessage("Ativando o GuiGuiPlayer...");
    try {
      const normalizedServer = /^https?:\/\//i.test(server.trim()) ? server.trim() : `http://${server.trim()}`;
      const response = await apiFetch(`/pairings/${encodeURIComponent(code)}/activate`, {
        method: "POST",
        body: JSON.stringify({ ...(registered ? {} : { activationCode }), credentials: { server: normalizedServer, username, password } })
      }, { skipSubdomain: true });
      const payload = await readApiJson<{ message?: string; companyName?: string }>(response);
      if (!response.ok) throw new Error(payload.message ?? "Nao foi possivel ativar");
      setStatus("success");
      setMessage(`Tudo certo${payload.companyName ? ` para ${payload.companyName}` : ""}! Volte para a TV; a configuracao sera concluida automaticamente.`);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Falha ao ativar");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-violet-950 to-slate-900 p-4 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-violet-300">Hub Regional</p>
        <h1 className="mt-2 text-3xl font-black">Configurar GuiGuiPlayer</h1>
        <p className="mt-2 text-sm text-white/65">Preencha pelo celular. Ao salvar, a TV recebe a configuração automaticamente.</p>
        <div className="mt-5 rounded-2xl bg-black/25 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-white/60">Codigo da TV</p>
          <p className="mt-1 font-mono text-3xl font-black tracking-widest">{code || "------"}</p>
        </div>
        {status !== "success" && <div className="mt-5 space-y-4">
          {!registered && <label className="block text-sm">Código de acesso
            <input className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-center font-mono text-xl font-bold uppercase tracking-widest text-slate-950" placeholder="DUMZ-965D-97PC" value={activationCode} disabled={status === "loading"} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} />
          </label>}
          <label className="block text-sm">URL ou host do servidor
            <input className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-slate-950" inputMode="url" placeholder="http://servidor.com:porta" value={server} disabled={status === "loading"} onChange={(event) => setServer(event.target.value)} />
          </label>
          <label className="block text-sm">Login
            <input className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-slate-950" autoComplete="username" placeholder="Seu login IPTV" value={username} disabled={status === "loading"} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="block text-sm">Senha
            <input type="password" className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-slate-950" autoComplete="current-password" placeholder="Sua senha IPTV" value={password} disabled={status === "loading"} onChange={(event) => setPassword(event.target.value)} />
          </label>
        </div>}
        <p className={`mt-4 rounded-xl p-3 text-sm ${status === "success" ? "bg-emerald-500/20 text-emerald-100" : status === "error" ? "bg-red-500/20 text-red-100" : "bg-white/10"}`}>{message}</p>
        {(status === "ready" || status === "error") && code && (
          <button className="mt-4 w-full rounded-2xl bg-violet-500 px-5 py-3 font-bold disabled:opacity-50" disabled={(!registered && activationCode.replace(/[^A-Z0-9]/g, "").length < 8) || !server.trim() || !username.trim() || !password} onClick={() => void activate()}>Salvar e enviar para a TV</button>
        )}
        <p className="mt-5 text-center text-xs text-white/50">Os dados são criptografados durante o envio e só são liberados se a licença estiver ativa.</p>
      </section>
    </main>
  );
}
