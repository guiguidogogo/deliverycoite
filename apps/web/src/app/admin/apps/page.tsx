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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDuration, setEditDuration] = useState("keep");
  const [editMaxDevices, setEditMaxDevices] = useState("1");
  const [manualPairingId, setManualPairingId] = useState<string | null>(null);
  const [tvCode, setTvCode] = useState("");
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
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

  function openEditor(subscription: Subscription) {
    setEditingId(subscription.id);
    setEditDuration("keep");
    setEditMaxDevices(String(subscription.maxDevices));
  }

  async function saveEditor(subscription: Subscription) {
    const body: { maxDevices: number; durationDays?: number | null } = { maxDevices: Number(editMaxDevices) };
    if (editDuration !== "keep") body.durationDays = editDuration === "lifetime" ? null : Number(editDuration);
    await patchSubscription(subscription.id, body, editDuration === "keep" ? "Limite de aparelhos atualizado" : "Licenca e validade atualizadas");
    setEditingId(null);
  }

  async function deleteSubscription(subscription: Subscription) {
    if (!window.confirm(`Excluir definitivamente a licenca de ${subscription.company.tradeName}? Os aparelhos vinculados perderao o acesso.`)) return;
    try {
      await adminApi(`/admin/apps/${subscription.id}`, { method: "DELETE" });
      toast.success("Licenca excluida");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao excluir licenca");
    }
  }

  async function manualPair(subscription: Subscription) {
    const pairingCode = tvCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pairingCode.length < 4) return toast.error("Informe o codigo exibido na TV");
    try {
      const result = await adminApi<{ activationCode: string }>(`/admin/apps/${subscription.id}/manual-pair`, {
        method: "POST",
        body: JSON.stringify({ pairingCode })
      });
      setActivationCode(result.activationCode);
      setTvCode("");
      setManualPairingId(null);
      toast.success("TV vinculada e novo codigo de 12 caracteres gerado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao vincular a TV");
    }
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

  function openDeviceEditor(device: Device, fallbackLabel: string) {
    setEditingDeviceId(device.id);
    setDeviceLabel(device.label?.trim() || fallbackLabel);
  }

  async function saveDevice(subscriptionId: string, device: Device) {
    const label = deviceLabel.trim();
    if (!label) return toast.error("Informe um nome para identificar o aparelho");
    try {
      await adminApi(`/admin/apps/${subscriptionId}/devices/${device.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label })
      });
      setEditingDeviceId(null);
      setDeviceLabel("");
      toast.success("Nome do aparelho atualizado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao editar aparelho");
    }
  }

  async function deleteDevice(subscriptionId: string, device: Device, fallbackLabel: string) {
    const name = device.label?.trim() || fallbackLabel;
    if (!window.confirm(`Excluir ${name}? Esta TV perdera o acesso e precisara ser vinculada novamente.`)) return;
    try {
      await adminApi(`/admin/apps/${subscriptionId}/devices/${device.id}`, { method: "DELETE" });
      if (editingDeviceId === device.id) setEditingDeviceId(null);
      toast.success("Aparelho excluido");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao excluir aparelho");
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
              <option value="60">60 dias</option><option value="90">90 dias</option><option value="180">6 meses</option><option value="365">1 ano</option><option value="lifetime">Vitalicio</option>
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
                <button className="rounded-xl bg-blue-700 px-3 py-2 text-sm text-white" onClick={() => openEditor(subscription)}>Editar</button>
                <button className="rounded-xl bg-amber-600 px-3 py-2 text-sm text-white" onClick={() => void regenerate(subscription.id)}>Novo codigo</button>
                <button className="rounded-xl bg-slate-700 px-3 py-2 text-sm text-white" onClick={() => { setEditingCredentialsId(subscription.id); setCredentials(emptyCredentials); }}>Alterar IPTV</button>
                <button className="rounded-xl bg-violet-700 px-3 py-2 text-sm text-white" onClick={() => { setManualPairingId(subscription.id); setTvCode(""); }}>Vincular codigo da TV</button>
                <button className={`rounded-xl px-3 py-2 text-sm text-white ${subscription.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void patchSubscription(subscription.id, { active: !subscription.active }, subscription.active ? "Licenca bloqueada" : "Licenca ativada")}>{subscription.active ? "Bloquear" : "Ativar"}</button>
                <button className="rounded-xl border border-red-600 px-3 py-2 text-sm font-semibold text-red-700" onClick={() => void deleteSubscription(subscription)}>Excluir</button>
              </div>
            </div>

            {editingId === subscription.id && (
              <div className="mt-4 rounded-xl border border-blue-300 bg-blue-50/70 p-4 dark:border-blue-800 dark:bg-blue-950/30">
                <p className="font-semibold">Editar licença</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-sm">Renovar validade
                    <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-slate-950" value={editDuration} onChange={(event) => setEditDuration(event.target.value)}>
                      <option value="keep">Manter validade atual</option><option value="7">7 dias de teste</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option><option value="180">6 meses</option><option value="365">1 ano</option><option value="lifetime">Vitalicio</option>
                    </select>
                  </label>
                  <label className="text-sm">Quantidade maxima de aparelhos
                    <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-slate-950" type="number" min="1" max="20" value={editMaxDevices} onChange={(event) => setEditMaxDevices(event.target.value)} />
                  </label>
                </div>
                <button className="mt-3 rounded-xl bg-blue-700 px-4 py-2 text-white" onClick={() => void saveEditor(subscription)}>Salvar alterações</button>
                <button className="ml-2 rounded-xl border px-4 py-2" onClick={() => setEditingId(null)}>Cancelar</button>
              </div>
            )}

            {manualPairingId === subscription.id && (
              <div className="mt-4 rounded-xl border border-violet-300 bg-violet-50/70 p-4 dark:border-violet-800 dark:bg-violet-950/30">
                <p className="font-semibold">Vincular uma Roku manualmente</p>
                <p className="mt-1 text-sm opacity-70">Digite o codigo curto que esta aparecendo na TV. A Roku sera vinculada a esta licenca e um novo codigo de acesso de 12 caracteres sera exibido.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input className="min-w-64 flex-1 rounded-xl border bg-white px-4 py-3 font-mono text-xl font-bold uppercase tracking-widest text-slate-950" placeholder="CODIGO DA TV" value={tvCode} maxLength={12} onChange={(event) => setTvCode(event.target.value.toUpperCase())} />
                  <button className="rounded-xl bg-violet-700 px-5 py-3 font-semibold text-white" onClick={() => void manualPair(subscription)}>Vincular e gerar codigo</button>
                  <button className="rounded-xl border px-4 py-2" onClick={() => setManualPairingId(null)}>Cancelar</button>
                </div>
              </div>
            )}

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
                <div className="grid gap-3 md:grid-cols-2">
                  {subscription.devices.map((device, index) => {
                    const fallbackLabel = `Roku ${index + 1}`;
                    const displayLabel = device.label?.trim() || fallbackLabel;
                    return <div key={device.id} className={`rounded-xl border p-4 ${device.active ? "border-emerald-500/70" : "border-red-400/60 opacity-75"}`}>
                      {editingDeviceId === device.id ? (
                        <div>
                          <label className="text-xs font-semibold">Nome para identificar este aparelho
                            <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-slate-950" maxLength={80} value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="Ex.: TV da sala" />
                          </label>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => void saveDevice(subscription.id, device)}>Salvar</button>
                            <button className="rounded-lg border px-3 py-2 text-xs" onClick={() => setEditingDeviceId(null)}>Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div><p className="font-semibold">{displayLabel}</p><p className={`text-xs font-semibold ${device.active ? "text-emerald-700" : "text-red-600"}`}>{device.active ? "Ativo" : "Bloqueado"}</p></div>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">Aparelho {index + 1}</span>
                          </div>
                          <p className="mt-2 text-xs opacity-60">Ultimo acesso: {new Date(device.lastSeenAt).toLocaleString("pt-BR")}</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => openDeviceEditor(device, fallbackLabel)}>Editar nome</button>
                            <button className={`rounded-lg px-3 py-2 text-xs font-semibold text-white ${device.active ? "bg-amber-600" : "bg-emerald-600"}`} onClick={() => void toggleDevice(subscription.id, device)}>{device.active ? "Bloquear" : "Desbloquear"}</button>
                            <button className="rounded-lg border border-red-600 px-3 py-2 text-xs font-semibold text-red-700" onClick={() => void deleteDevice(subscription.id, device, fallbackLabel)}>Excluir</button>
                          </div>
                        </>
                      )}
                    </div>;
                  })}
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
