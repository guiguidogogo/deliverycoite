"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../lib/admin-api";

type Device = { id: string; label?: string | null; active: boolean; activatedAt: string; lastSeenAt: string };
type Status = "active" | "inactive" | "expired" | "scheduled";
type Plan = "TRIAL_7_DAYS" | "DAYS_30" | "DAYS_60" | "DAYS_90" | "MONTHS_6" | "YEAR_1" | "LIFETIME";
type Subscription = { id: string; status: Status; active: boolean; expiresAt?: string | null; maxDevices: number; configured: boolean; devices: Device[] };
type Subscriber = {
  id: string;
  name: string;
  phone?: string | null;
  active: boolean;
  status: Status;
  plan: Plan;
  startsAt: string;
  expiresAt?: string | null;
  maxDevices: number;
  activationCode: string;
  devices: Device[];
};

const statusText: Record<Status, string> = { active: "Ativo", inactive: "Bloqueado", expired: "Expirado", scheduled: "Agendado" };
const planText: Record<Plan, string> = {
  TRIAL_7_DAYS: "Teste de 7 dias",
  DAYS_30: "30 dias",
  DAYS_60: "60 dias",
  DAYS_90: "90 dias",
  MONTHS_6: "6 meses",
  YEAR_1: "1 ano",
  LIFETIME: "Vitalício"
};
const emptyForm = { name: "", phone: "", plan: "TRIAL_7_DAYS" as Plan, maxDevices: 1 };
const emptyCredentials = { server: "", username: "", password: "" };

export function IptvAdminPanel() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pairingSubscriberId, setPairingSubscriberId] = useState<string | null>(null);
  const [tvCode, setTvCode] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [showCredentials, setShowCredentials] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await adminApi<Subscription | null>("/admin/my-app");
      setSubscription(current);
      setSubscribers(current ? await adminApi<Subscriber[]>("/admin/my-app/subscribers") : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar o painel IPTV");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function newSubscriber() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function editSubscriber(item: Subscriber) {
    setEditingId(item.id);
    setForm({ name: item.name, phone: item.phone ?? "", plan: item.plan, maxDevices: item.maxDevices });
    setShowForm(true);
    window.scrollTo({ top: 300, behavior: "smooth" });
  }

  async function saveSubscriber() {
    if (form.name.trim().length < 2) return toast.error("Informe o nome do assinante");
    setSaving(true);
    try {
      const saved = await adminApi<Subscriber>(editingId ? `/admin/my-app/subscribers/${editingId}` : "/admin/my-app/subscribers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      toast.success(editingId ? "Assinante atualizado e período reiniciado" : `Assinante criado. Código: ${saved.activationCode}`);
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar assinante");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSubscriber(item: Subscriber) {
    try {
      await adminApi(`/admin/my-app/subscribers/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !item.active })
      });
      toast.success(item.active ? "Assinante bloqueado" : "Assinante liberado");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao alterar assinante"); }
  }

  async function regenerateCode(item: Subscriber) {
    if (!window.confirm(`Gerar um novo código para ${item.name}? O código atual deixará de funcionar.`)) return;
    try {
      const result = await adminApi<{ activationCode: string }>(`/admin/my-app/subscribers/${item.id}/activation-code`, { method: "POST" });
      await navigator.clipboard.writeText(result.activationCode).catch(() => undefined);
      toast.success(`Novo código copiado: ${result.activationCode}`);
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao gerar código"); }
  }

  async function manualPairSubscriber(item: Subscriber) {
    const pairingCode = tvCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pairingCode.length < 4) return toast.error("Informe o código exibido na TV");
    try {
      const result = await adminApi<{ activationCode: string }>(
        `/admin/my-app/subscribers/${item.id}/manual-pair`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairingCode })
        }
      );
      await navigator.clipboard.writeText(result.activationCode).catch(() => undefined);
      toast.success(`TV vinculada. Novo código: ${result.activationCode}`);
      setPairingSubscriberId(null);
      setTvCode("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao vincular a TV");
    }
  }

  async function removeSubscriber(item: Subscriber) {
    if (!window.confirm(`Excluir ${item.name}? O acesso e os aparelhos vinculados serão removidos.`)) return;
    try {
      await adminApi(`/admin/my-app/subscribers/${item.id}`, { method: "DELETE" });
      toast.success("Assinante excluído");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao excluir assinante"); }
  }

  async function toggleDevice(device: Device) {
    try {
      await adminApi(`/admin/my-app/devices/${device.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !device.active }) });
      toast.success(device.active ? "Aparelho bloqueado" : "Aparelho liberado");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao alterar o aparelho"); }
  }

  async function saveCredentials() {
    if (!credentials.server.trim() || !credentials.username.trim() || !credentials.password) {
      return toast.error("Informe o host, o usuario e a senha do IPTV");
    }
    setSavingCredentials(true);
    try {
      const updated = await adminApi<Subscription>("/admin/my-app/credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
      });
      setSubscription(updated);
      setCredentials(emptyCredentials);
      setShowCredentials(false);
      toast.success("Host, usuario e senha do IPTV atualizados");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar os dados do IPTV");
    } finally {
      setSavingCredentials(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-violet-300">Administração de app</p>
        <h1 className="mt-2 text-4xl font-black">GuiGuiPlayer IPTV</h1>
        <p className="mt-2 max-w-3xl text-white/70">Gerencie assinantes, períodos de acesso, códigos e aparelhos. Este módulo é separado de delivery, cardápio e rifas.</p>

        {loading ? <div className="mt-8 rounded-3xl bg-white/10 p-8">Carregando licenças...</div> : !subscription ? (
          <section className="mt-8 rounded-3xl border border-amber-400/40 bg-amber-400/10 p-7"><h2 className="text-2xl font-bold">Licença ainda não liberada</h2><p className="mt-2 text-white/75">O administrador master precisa liberar o GuiGuiPlayer para esta empresa.</p></section>
        ) : <>
          <section className="mt-8 grid gap-4 md:grid-cols-4">
            <InfoCard label="Conta principal" value={statusText[subscription.status]} tone={subscription.status === "active" ? "green" : "amber"} />
            <InfoCard label="Validade da conta" value={formatDate(subscription.expiresAt)} />
            <InfoCard label="Lista IPTV" value={subscription.configured ? "Configurada" : "Pendente"} tone={subscription.configured ? "green" : "amber"} />
            <InfoCard label="Assinantes ativos" value={String(subscribers.filter((item) => item.status === "active").length)} tone="green" />
          </section>

          <section className="mt-6 rounded-3xl border border-violet-300/25 bg-white/10 p-6 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">Dados da lista IPTV</h2>
                <p className="mt-1 text-sm text-white/65">
                  {subscription.configured
                    ? "A lista esta configurada. Preencha os tres campos somente quando quiser substituir os dados atuais."
                    : "Informe os dados fornecidos pelo seu servidor IPTV."}
                </p>
              </div>
              <button
                className="rounded-xl bg-violet-500 px-5 py-3 font-bold hover:bg-violet-400"
                onClick={() => setShowCredentials((current) => !current)}
              >
                {showCredentials ? "Cancelar" : subscription.configured ? "Alterar dados IPTV" : "Configurar IPTV"}
              </button>
            </div>

            {showCredentials && <div className="mt-5 rounded-2xl border border-violet-300/30 bg-black/25 p-5">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Host / servidor IPTV">
                  <input
                    type="url"
                    value={credentials.server}
                    onChange={(event) => setCredentials({ ...credentials, server: event.target.value })}
                    placeholder="http://servidor.com:8080"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Login / usuario IPTV">
                  <input
                    value={credentials.username}
                    onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
                    placeholder="Usuario IPTV"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Senha IPTV">
                  <input
                    type="password"
                    value={credentials.password}
                    onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
                    placeholder="Senha IPTV"
                    autoComplete="new-password"
                  />
                </Field>
              </div>
              <p className="mt-3 text-xs text-white/50">Por seguranca, a senha atual nunca e exibida. Ao salvar, os tres dados anteriores serao substituidos.</p>
              <button disabled={savingCredentials} className="mt-4 rounded-xl bg-emerald-600 px-5 py-3 font-bold disabled:opacity-50" onClick={() => void saveCredentials()}>
                {savingCredentials ? "Salvando..." : "Salvar dados IPTV"}
              </button>
            </div>}
          </section>

          <section className="mt-6 rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-2xl font-bold">Assinantes do app</h2><p className="mt-1 text-sm text-white/65">Cada pessoa recebe um código e uma validade próprios.</p></div>
              <button className="rounded-xl bg-violet-500 px-5 py-3 font-bold hover:bg-violet-400" onClick={newSubscriber}>+ Novo assinante</button>
            </div>

            {showForm && <div className="mt-6 rounded-2xl border border-violet-300/30 bg-black/25 p-5">
              <h3 className="text-lg font-bold">{editingId ? "Editar e renovar assinante" : "Cadastrar assinante"}</h3>
              {editingId && <p className="mt-1 text-sm text-amber-200">Ao salvar, o período escolhido começa novamente a partir de hoje.</p>}
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do cliente" /></Field>
                <Field label="Telefone (opcional)"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" /></Field>
                <Field label="Período de acesso"><select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value as Plan })}>{Object.entries(planText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                <Field label="Quantidade de TVs"><input type="number" min={1} max={10} value={form.maxDevices} onChange={(e) => setForm({ ...form, maxDevices: Number(e.target.value) })} /></Field>
              </div>
              <div className="mt-4 flex gap-3"><button disabled={saving} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold disabled:opacity-50" onClick={() => void saveSubscriber()}>{saving ? "Salvando..." : editingId ? "Salvar e renovar" : "Criar e gerar código"}</button><button className="rounded-xl bg-white/10 px-5 py-3" onClick={() => setShowForm(false)}>Cancelar</button></div>
            </div>}

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {subscribers.length === 0 && <p className="rounded-2xl border border-dashed border-white/20 p-6 text-white/60 lg:col-span-2">Nenhum assinante cadastrado. Clique em “Novo assinante” para gerar o primeiro acesso.</p>}
              {subscribers.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{item.name}</h3><p className="text-sm text-white/55">{item.phone || "Sem telefone"}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${item.status === "active" ? "bg-emerald-500/20 text-emerald-200" : "bg-red-500/20 text-red-200"}`}>{statusText[item.status]}</span></div>
                <div className="mt-4 rounded-xl bg-violet-500/15 p-4"><p className="text-xs uppercase tracking-wider text-white/55">Código de acesso</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><strong className="font-mono text-xl tracking-wider">{item.activationCode}</strong><button className="text-sm text-violet-200 underline" onClick={() => void navigator.clipboard.writeText(item.activationCode).then(() => toast.success("Código copiado"))}>Copiar</button></div></div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-white/50">Plano</p><p className="font-semibold">{planText[item.plan]}</p></div><div><p className="text-white/50">Validade</p><p className="font-semibold">{formatDate(item.expiresAt)}</p></div></div>
                {item.devices.map((device) => <div key={device.id} className="mt-3 flex items-center justify-between rounded-xl bg-white/5 p-3"><div><p className="font-semibold">{device.label || "Roku"}</p><p className="text-xs text-white/50">Último acesso: {new Date(device.lastSeenAt).toLocaleString("pt-BR")}</p></div><button className={`rounded-lg px-3 py-2 text-xs font-bold ${device.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void toggleDevice(device)}>{device.active ? "Bloquear TV" : "Liberar TV"}</button></div>)}
                <div className="mt-5 flex flex-wrap gap-2"><button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold" onClick={() => editSubscriber(item)}>Editar / renovar</button><button className={`rounded-lg px-3 py-2 text-sm font-semibold ${item.active ? "bg-amber-600" : "bg-emerald-600"}`} onClick={() => void toggleSubscriber(item)}>{item.active ? "Bloquear" : "Liberar"}</button><button className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold" onClick={() => void regenerateCode(item)}>Novo código</button><button className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-semibold" onClick={() => { setPairingSubscriberId(item.id); setTvCode(""); }}>Vincular código da TV</button><button className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold" onClick={() => void removeSubscriber(item)}>Excluir</button></div>
                {pairingSubscriberId === item.id && <div className="mt-4 rounded-xl border border-fuchsia-300/30 bg-fuchsia-500/10 p-4">
                  <p className="font-semibold">Vincular esta TV a {item.name}</p>
                  <p className="mt-1 text-sm text-white/60">Digite o código curto que está aparecendo na televisão.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input className="min-w-52 flex-1 rounded-xl bg-white px-4 py-3 font-mono text-lg font-bold uppercase tracking-widest text-slate-950" placeholder="CÓDIGO DA TV" maxLength={12} value={tvCode} onChange={(event) => setTvCode(event.target.value.toUpperCase())} />
                    <button className="rounded-xl bg-fuchsia-600 px-5 py-3 font-bold" onClick={() => void manualPairSubscriber(item)}>Vincular e liberar</button>
                    <button className="rounded-xl bg-white/10 px-4 py-3" onClick={() => setPairingSubscriberId(null)}>Cancelar</button>
                  </div>
                </div>}
              </article>)}
            </div>

            {subscription.devices.length > 0 && <div className="mt-8 border-t border-white/10 pt-6">
              <h3 className="text-lg font-bold">Aparelhos da licença anterior</h3>
              <p className="mt-1 text-sm text-white/55">Estes aparelhos continuam funcionando com o código antigo até você migrá-los para um assinante individual.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">{subscription.devices.map((device) => <div key={device.id} className="flex items-center justify-between rounded-xl bg-white/5 p-4"><div><p className="font-semibold">{device.label || "Roku"}</p><p className="text-xs text-white/50">Último acesso: {new Date(device.lastSeenAt).toLocaleString("pt-BR")}</p></div><button className={`rounded-lg px-3 py-2 text-xs font-bold ${device.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void toggleDevice(device)}>{device.active ? "Bloquear TV" : "Liberar TV"}</button></div>)}</div>
            </div>}
          </section>
        </>}
      </div>
    </main>
  );
}

function formatDate(value?: string | null) { return value ? new Date(value).toLocaleDateString("pt-BR") : "Vitalício"; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-semibold text-white/75">{label}<div className="mt-2 [&_input]:w-full [&_input]:rounded-xl [&_input]:bg-white [&_input]:px-3 [&_input]:py-3 [&_input]:text-slate-950 [&_select]:w-full [&_select]:rounded-xl [&_select]:bg-white [&_select]:px-3 [&_select]:py-3 [&_select]:text-slate-950">{children}</div></label>; }
function InfoCard({ label, value, tone = "violet" }: { label: string; value: string; tone?: "violet" | "green" | "amber" }) { const color = tone === "green" ? "border-emerald-400/40 bg-emerald-400/10" : tone === "amber" ? "border-amber-400/40 bg-amber-400/10" : "border-violet-400/40 bg-violet-400/10"; return <div className={`rounded-3xl border p-5 ${color}`}><p className="text-sm text-white/60">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>; }
