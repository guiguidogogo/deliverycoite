"use client";

import { useEffect, useState } from "react";
import { apiFetch, readApiJson } from "../../../../lib/api";

type PairingInfo = { status: string; expiresAt: string; message?: string };

export default function RokuPairPage() {
  const [code, setCode] = useState("");
  const [activationCode, setActivationCode] = useState("");
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
        setStatus("ready");
        setMessage("Digite o codigo de ativacao fornecido pelo vendedor.");
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
      const response = await apiFetch(`/pairings/${encodeURIComponent(code)}/activate`, {
        method: "POST",
        body: JSON.stringify({ activationCode })
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
        <h1 className="mt-2 text-3xl font-black">Ativar GuiGuiPlayer</h1>
        <div className="mt-5 rounded-2xl bg-black/25 p-4 text-center">
          <p className="text-xs uppercase tracking-widest text-white/60">Codigo da TV</p>
          <p className="mt-1 font-mono text-3xl font-black tracking-widest">{code || "------"}</p>
        </div>
        {status !== "success" && (
          <label className="mt-5 block text-sm">Codigo de ativacao
            <input className="mt-2 w-full rounded-2xl border border-white/20 bg-white px-4 py-3 text-center font-mono text-xl font-bold uppercase tracking-widest text-slate-950" placeholder="XXXX-XXXX-XXXX" value={activationCode} disabled={status === "loading"} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} />
          </label>
        )}
        <p className={`mt-4 rounded-xl p-3 text-sm ${status === "success" ? "bg-emerald-500/20 text-emerald-100" : status === "error" ? "bg-red-500/20 text-red-100" : "bg-white/10"}`}>{message}</p>
        {(status === "ready" || status === "error") && code && (
          <button className="mt-4 w-full rounded-2xl bg-violet-500 px-5 py-3 font-bold disabled:opacity-50" disabled={activationCode.replace(/[^A-Z0-9]/g, "").length < 8} onClick={() => void activate()}>Ativar na TV</button>
        )}
        <p className="mt-5 text-center text-xs text-white/50">As credenciais da lista sao enviadas diretamente para a TV e nao ficam visiveis nesta pagina.</p>
      </section>
    </main>
  );
}
