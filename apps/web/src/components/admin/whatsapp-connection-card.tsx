"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch, readApiJson } from "../../lib/api";

type WhatsappStatus =
  | "not_configured"
  | "unavailable"
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "qr_required"
  | "logged_out"
  | "error";

type WhatsappConnection = {
  available: boolean;
  instance_exists: boolean;
  connected: boolean;
  status: WhatsappStatus;
  phone?: string | null;
  profile_name?: string | null;
  profile_picture_url?: string | null;
  qr_code?: string;
  pairing_code?: string;
  requires_qr?: boolean;
};

const statusLabels: Record<WhatsappStatus, string> = {
  not_configured: "Nao configurado",
  unavailable: "Servico indisponivel",
  connected: "Conectado",
  connecting: "Conectando",
  reconnecting: "Reconectando",
  disconnected: "Desconectado",
  qr_required: "Aguardando leitura do QR Code",
  logged_out: "Sessao encerrada",
  error: "Erro na conexao"
};

function qrImage(value?: string) {
  if (!value) return "";
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

function formatPhone(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return value || "Nao informado";
}

export function WhatsappConnectionCard() {
  const [connection, setConnection] = useState<WhatsappConnection | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const mounted = useRef(true);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const token = localStorage.getItem("delivery:token");
    if (!token) throw new Error("Sessao expirada. Entre novamente.");
    const response = await apiFetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init?.headers },
      cache: "no-store"
    });
    const payload = await readApiJson<WhatsappConnection & { message?: string }>(response).catch(() => ({} as WhatsappConnection & { message?: string }));
    if (!response.ok) throw new Error(payload.message ?? "Falha ao acessar o WhatsApp");
    return payload;
  }, []);

  const refreshStatus = useCallback(async (silent = false) => {
    try {
      const data = await request("/admin/integrations/whatsapp/status");
      if (!mounted.current) return;
      setConnection(data);
      if (data.connected) setQrCode("");
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Falha ao consultar WhatsApp");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    mounted.current = true;
    void refreshStatus();
    return () => { mounted.current = false; };
  }, [refreshStatus]);

  useEffect(() => {
    if (!connection) return;
    const fastPolling = ["connecting", "reconnecting", "qr_required"].includes(connection.status);
    const interval = window.setInterval(() => void refreshStatus(true), fastPolling ? 4000 : 30000);
    return () => window.clearInterval(interval);
  }, [connection?.status, refreshStatus]);

  async function connect() {
    setAction("connect");
    try {
      const data = await request("/admin/integrations/whatsapp/connect", { method: "POST" });
      setConnection(data);
      setQrCode(qrImage(data.qr_code));
      if (data.connected) toast.success("WhatsApp ja esta conectado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexao");
    } finally {
      setAction("");
    }
  }

  async function loadQrCode() {
    setAction("qrcode");
    try {
      const data = await request("/admin/integrations/whatsapp/qrcode");
      setConnection(data);
      setQrCode(qrImage(data.qr_code));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar QR Code");
    } finally {
      setAction("");
    }
  }

  async function reconnect() {
    setAction("reconnect");
    try {
      const data = await request("/admin/integrations/whatsapp/reconnect", { method: "POST" });
      setConnection(data);
      if (data.requires_qr) await loadQrCode();
      else toast.success("Reconexao iniciada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reconectar");
    } finally {
      setAction("");
    }
  }

  async function logout() {
    if (!window.confirm("Deseja desconectar este WhatsApp do HubRegional?")) return;
    setAction("logout");
    try {
      await request("/admin/integrations/whatsapp/logout", { method: "POST" });
      setQrCode("");
      setConnection((current) => current ? { ...current, connected: false, status: "logged_out" } : current);
      toast.success("WhatsApp desconectado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desconectar");
    } finally {
      setAction("");
    }
  }

  async function testConnection() {
    setAction("test");
    try {
      await request("/admin/integrations/whatsapp/test", { method: "POST" });
      toast.success("Mensagem de teste colocada na fila");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar teste");
    } finally {
      setAction("");
    }
  }

  const status = connection?.status ?? "disconnected";
  const connected = Boolean(connection?.connected);
  const busy = Boolean(action);

  return (
    <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide">WhatsApp oficial da loja</p>
          <h2 className="text-xl font-black">Conexao por QR Code</h2>
          <p className="mt-1 max-w-2xl text-sm opacity-80">
            Conecte o WhatsApp desta empresa para enviar confirmacoes e atualizacoes pelo HubRegional.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${connected ? "bg-emerald-600 text-white" : "bg-white/80 text-slate-700 dark:bg-black/20 dark:text-slate-100"}`}>
          {loading ? "Consultando..." : `${connected ? "●" : "○"} ${statusLabels[status]}`}
        </span>
      </div>

      {connection?.status === "unavailable" && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          A integracao central ainda nao foi habilitada no servidor. Fale com o suporte HubRegional.
        </div>
      )}

      {connected && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-white/80 p-3 dark:bg-black/20">
            <p className="text-xs font-bold uppercase opacity-60">Numero</p>
            <p className="mt-1 font-bold">{formatPhone(connection?.phone)}</p>
          </div>
          <div className="rounded-xl bg-white/80 p-3 dark:bg-black/20">
            <p className="text-xs font-bold uppercase opacity-60">Nome no WhatsApp</p>
            <p className="mt-1 font-bold">{connection?.profile_name || "Nao informado"}</p>
          </div>
        </div>
      )}

      {qrCode && !connected && (
        <div className="mt-4 grid items-center gap-4 rounded-2xl bg-white p-4 text-slate-900 md:grid-cols-[auto_1fr] dark:bg-slate-950 dark:text-white">
          <img className="mx-auto h-64 w-64 rounded-xl bg-white p-2" src={qrCode} alt="QR Code para conectar o WhatsApp" />
          <div>
            <h3 className="text-lg font-black">Escaneie o QR Code</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm opacity-80">
              <li>Abra o WhatsApp no celular.</li>
              <li>Acesse Configuracoes e depois Aparelhos conectados.</li>
              <li>Toque em Conectar um aparelho e leia este codigo.</li>
            </ol>
            <p className="mt-3 text-xs opacity-60">A tela atualiza automaticamente depois da conexao.</p>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {!connected && connection?.status !== "unavailable" && (
          <button type="button" className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50" onClick={() => void connect()} disabled={busy}>
            {action === "connect" ? "Gerando QR Code..." : connection?.instance_exists ? "Conectar WhatsApp" : "Configurar WhatsApp"}
          </button>
        )}
        {!connected && connection?.instance_exists && connection?.status !== "unavailable" && (
          <button type="button" className="rounded-xl border border-emerald-700 px-4 py-2 font-bold disabled:opacity-50" onClick={() => void reconnect()} disabled={busy}>
            {action === "reconnect" ? "Reconectando..." : "Tentar reconectar"}
          </button>
        )}
        {!connected && connection?.instance_exists && (
          <button type="button" className="rounded-xl border border-black/10 px-4 py-2 font-semibold dark:border-white/20" onClick={() => void loadQrCode()} disabled={busy}>
            Atualizar QR Code
          </button>
        )}
        {connected && (
          <>
            <button type="button" className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50" onClick={() => void testConnection()} disabled={busy}>
              {action === "test" ? "Enviando..." : "Testar envio"}
            </button>
            <button type="button" className="rounded-xl border border-red-300 px-4 py-2 font-bold text-red-700 disabled:opacity-50 dark:text-red-300" onClick={() => void logout()} disabled={busy}>
              {action === "logout" ? "Desconectando..." : "Desconectar"}
            </button>
          </>
        )}
        <button type="button" className="rounded-xl border border-black/10 px-4 py-2 font-semibold dark:border-white/20" onClick={() => void refreshStatus()} disabled={busy || loading}>
          Atualizar status
        </button>
      </div>
    </section>
  );
}
