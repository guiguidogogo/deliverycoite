"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi, requireMaster } from "../../../lib/admin-api";

type Company = { id: string; tradeName: string; companyName: string; active: boolean };
type Device = { id: string; label?: string | null; active: boolean; activatedAt: string; lastSeenAt: string };
type Subscription = {
  id: string;
  status: "active" | "inactive" | "expired" | "scheduled";
  active: boolean;
  startsAt: string;
  expiresAt?: string | null;
  maxDevices: number;
  configured: boolean;
  company: Company;
  devices: Device[];
};

const emptyCredentials = { server: "", username: "", password: "" };

function statusLabel(status: Subscription["status"]) {
  return { active: "Ativa", inactive: "Inativa", expired: "Expirada", scheduled: "Agendada" }[status];
}

export default function AppsManagerPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [maxDevices, setMaxDevices] = useState("1");
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [activationCode, setActivationCode] = useState("");
  const [editingCredentialsId, setEditingCredentialsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await requireMaster();
      const [companyList, appList] = await Promise.all([
        adminApi<Company[]>("/admin/companies"),
        adminApi<Subscription[]>("/admin/apps")
      ]);
      setCompanies(companyList);
      setSubscriptions(appList);
      const requestedCompany = new URLSearchParams(window.location.search).get("companyId") ?? "";
      setCompanyId((current) => current || requestedCompany || companyList[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Acesso negado");
      window.location.href = "/admin/companies";
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createSubscription() {
    try {
      const created = await adminApi<Subscription & { activationCode: string }>("/admin/apps", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          durationDays: durationDays === "lifetime" ? null : Number(durationDays),
          maxDevices: Number(maxDevices),
          credentials
        })
      });
      setActivationCode(created.activationCode);
      setCredentials(emptyCredentials);
      toast.success("GuiGuiPlayer vendido e configurado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar a licenca");
    }
  }

  async function patchSubscription(id: string, body: object, success: string) {
    try {
      await adminApi(`/admin/apps/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar a licenca");
    }
  }

  async function regenerate(id: string) {
    if (!window.confirm("O codigo anterior deixara de funcionar. Deseja continuar?")) return;
    try {
      const result = await adminApi<{ activationCode: string }>(`/admin/apps/${id}/activation-code`, { method: "POST" });
      setActivationCode(result.activationCode);
      toast.success("Novo codigo gerado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar codigo");
    }
  }

  async function updateCredentials(id: string) {
    await patchSubscription(id, { credentials }, "Lista IPTV atualizada");
    setEditingCredentialsId(null);
    setCredentials(emptyCredentials);
  }

  async function toggleDevice(subscriptionId: string, device: Device) {
    try {
      await adminApi(`/admin/apps/${subscriptionId}/devices/${device.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !device.active })
      });
      toast.success(device.active ? "Aparelho bloqueado" : "Aparelho liberado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar aparelho");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-violet-700">Painel Master SaaS</p>
          <h1 className="font-display text-4xl">Gerenciador de Apps</h1>
          <p className="mt-1 text-sm opacity-70">Area exclusiva para licencas de aplicativos. Separada do Delivery e das Rifas.</p>
        </div>
        <a className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20" href="/admin/companies">Voltar para empresas</a>
      </header>

      {activationCode && (
        <section className="mt-5 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50">
          <p className="font-semibold">Codigo de ativacao — copie e entregue ao cliente agora</p>
          <p className="my-2 font-mono text-3xl font-black tracking-widest">{activationCode}</p>
          <p className="text-sm">Por seguranca, ele nao volta a ser exibido. Se perder, gere um novo codigo na licenca.</p>
          <button className="mt-3 rounded-xl bg-emerald-700 px-4 py-2 text-white" onClick={() => void navigator.clipboard.writeText(activationCode)}>Copiar codigo</button>
          <button className="ml-2 rounded-xl border border-emerald-700 px-4 py-2" onClick={() => setActivationCode("")}>Fechar</button>
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Vender GuiGuiPlayer</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm">Empresa cliente
            <select className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.tradeName}</option>)}
            </select>
          </label>
          <label className="text-sm">Tempo de uso
            <select className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" value={durationDays} onChange={(event) => setDurationDays(event.target.value)}>
              <option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option>
              <option value="90">90 dias</option><option value="365">1 ano</option><option value="lifetime">Sem vencimento</option>
            </select>
          </label>
          <label className="text-sm">Quantidade de aparelhos
            <input className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" type="number" min="1" max="20" value={maxDevices} onChange={(event) => setMaxDevices(event.target.value)} />
          </label>
        </div>
        <CredentialsFields value={credentials} onChange={setCredentials} />
        <button disabled={!companyId} className="mt-4 rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white disabled:opacity-50" onClick={() => void createSubscription()}>
          Vender app e gerar codigo
        </button>
      </section>

      <section className="mt-6 space-y-4">
        <h2 className="text-2xl font-bold">Licencas vendidas</h2>
        {loading && <p>Carregando...</p>}
        {!loading && subscriptions.length === 0 && <div className="rounded-2xl border border-dashed p-8 text-center opacity-70">Nenhuma licenca vendida.</div>}
        {subscriptions.map((subscription) => (
          <article key={subscription.id} className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold">GuiGuiPlayer — {subscription.company.tradeName}</h3>
                  <span className={`rounded-full px-2 py-1 text-xs ${subscription.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{statusLabel(subscription.status)}</span>
                </div>
                <p className="mt-1 text-sm opacity-70">Validade: {subscription.expiresAt ? new Date(subscription.expiresAt).toLocaleDateString("pt-BR") : "sem vencimento"}</p>
                <p className="text-sm opacity-70">Aparelhos: {subscription.devices.filter((item) => item.active).length}/{subscription.maxDevices} · IPTV {subscription.configured ? "configurada" : "pendente"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="rounded-xl bg-blue-700 px-3 py-2 text-sm text-white" onClick={() => void patchSubscription(subscription.id, { durationDays: 30, active: true }, "Licenca renovada por 30 dias")}>Renovar 30 dias</button>
                <button className="rounded-xl bg-amber-600 px-3 py-2 text-sm text-white" onClick={() => void regenerate(subscription.id)}>Novo codigo</button>
                <button className="rounded-xl bg-slate-700 px-3 py-2 text-sm text-white" onClick={() => { setEditingCredentialsId(subscription.id); setCredentials(emptyCredentials); }}>Alterar IPTV</button>
                <button className={`rounded-xl px-3 py-2 text-sm text-white ${subscription.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void patchSubscription(subscription.id, { active: !subscription.active }, subscription.active ? "Licenca bloqueada" : "Licenca ativada")}>{subscription.active ? "Bloquear" : "Ativar"}</button>
              </div>
            </div>

            {editingCredentialsId === subscription.id && (
              <div className="mt-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
                <p className="font-semibold">Substituir credenciais IPTV</p>
                <CredentialsFields value={credentials} onChange={setCredentials} />
                <button className="mt-3 rounded-xl bg-violet-700 px-4 py-2 text-white" onClick={() => void updateCredentials(subscription.id)}>Salvar nova lista</button>
                <button className="ml-2 rounded-xl border px-4 py-2" onClick={() => setEditingCredentialsId(null)}>Cancelar</button>
              </div>
            )}

            {subscription.devices.length > 0 && (
              <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
                <p className="mb-2 text-sm font-semibold">Aparelhos vinculados</p>
                <div className="flex flex-wrap gap-2">
                  {subscription.devices.map((device) => (
                    <button key={device.id} className={`rounded-xl border px-3 py-2 text-xs ${device.active ? "border-emerald-500" : "opacity-60"}`} onClick={() => void toggleDevice(subscription.id, device)}>
                      {device.label || "Roku"} · {device.active ? "Ativo" : "Bloqueado"}<br />
                      <span className="opacity-60">ultimo acesso {new Date(device.lastSeenAt).toLocaleString("pt-BR")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

function CredentialsFields({ value, onChange }: { value: typeof emptyCredentials; onChange: (value: typeof emptyCredentials) => void }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="text-sm">Servidor IPTV
        <input className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" placeholder="https://servidor.exemplo.com:8080" value={value.server} onChange={(event) => onChange({ ...value, server: event.target.value })} />
      </label>
      <label className="text-sm">Usuario IPTV
        <input className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" autoComplete="off" value={value.username} onChange={(event) => onChange({ ...value, username: event.target.value })} />
      </label>
      <label className="text-sm">Senha IPTV
        <input className="mt-1 w-full rounded-xl border bg-transparent px-3 py-2" type="password" autoComplete="new-password" value={value.password} onChange={(event) => onChange({ ...value, password: event.target.value })} />
      </label>
    </div>
  );
}
