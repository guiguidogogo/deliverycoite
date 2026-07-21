"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../lib/admin-api";

type Device = { id: string; label?: string | null; active: boolean; activatedAt: string; lastSeenAt: string };
type Subscription = {
  id: string;
  status: "active" | "inactive" | "expired" | "scheduled";
  active: boolean;
  expiresAt?: string | null;
  maxDevices: number;
  configured: boolean;
  devices: Device[];
};

const statusText = {
  active: "Ativa",
  inactive: "Bloqueada",
  expired: "Expirada",
  scheduled: "Agendada"
} as const;

export function IptvAdminPanel() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSubscription(await adminApi<Subscription | null>("/admin/my-app"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar a licença");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleDevice(device: Device) {
    try {
      await adminApi(`/admin/my-app/devices/${device.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !device.active })
      });
      toast.success(device.active ? "Aparelho bloqueado" : "Aparelho liberado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar o aparelho");
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-violet-300">Administração de app</p>
        <h1 className="mt-2 text-4xl font-black">GuiGuiPlayer IPTV</h1>
        <p className="mt-2 max-w-2xl text-white/70">Painel exclusivo da licença e dos aparelhos. Pedidos, cardápio, delivery e rifas não fazem parte deste módulo.</p>

        {loading ? <div className="mt-8 rounded-3xl bg-white/10 p-8">Carregando licença...</div> : !subscription ? (
          <section className="mt-8 rounded-3xl border border-amber-400/40 bg-amber-400/10 p-7">
            <h2 className="text-2xl font-bold">Licença ainda não liberada</h2>
            <p className="mt-2 text-white/75">O administrador master precisa vender e configurar o GuiGuiPlayer para esta empresa.</p>
          </section>
        ) : <>
          <section className="mt-8 grid gap-4 md:grid-cols-3">
            <InfoCard label="Situação" value={statusText[subscription.status]} tone={subscription.status === "active" ? "green" : "amber"} />
            <InfoCard label="Validade" value={subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString("pt-BR") : "Sem vencimento"} />
            <InfoCard label="Lista IPTV" value={subscription.configured ? "Configurada" : "Pendente"} tone={subscription.configured ? "green" : "amber"} />
          </section>

          <section className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-2xl font-bold">Aparelhos Roku</h2>
                <p className="mt-1 text-sm text-white/65">Ativos: {subscription.devices.filter((item) => item.active).length} de {subscription.maxDevices}</p>
              </div>
              <p className="text-sm text-white/60">O código de ativação é fornecido pelo administrador master.</p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {subscription.devices.length === 0 && <p className="rounded-2xl border border-dashed border-white/20 p-5 text-white/60">Nenhuma TV vinculada ainda.</p>}
              {subscription.devices.map((device) => (
                <article key={device.id} className="rounded-2xl bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{device.label || "Roku"}</p>
                      <p className="mt-1 text-xs text-white/55">Último acesso: {new Date(device.lastSeenAt).toLocaleString("pt-BR")}</p>
                    </div>
                    <button className={`rounded-xl px-3 py-2 text-sm font-semibold ${device.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void toggleDevice(device)}>
                      {device.active ? "Bloquear" : "Liberar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}

function InfoCard({ label, value, tone = "violet" }: { label: string; value: string; tone?: "violet" | "green" | "amber" }) {
  const color = tone === "green" ? "border-emerald-400/40 bg-emerald-400/10" : tone === "amber" ? "border-amber-400/40 bg-amber-400/10" : "border-violet-400/40 bg-violet-400/10";
  return <div className={`rounded-3xl border p-5 ${color}`}><p className="text-sm text-white/60">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>;
}
