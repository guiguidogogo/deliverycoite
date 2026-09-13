"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch, readApiJson } from "../../../../lib/api";
import { adminApi } from "../../../../lib/admin-api";

type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address: string;
  number: string;
  district: string;
  complement?: string | null;
  _count: {
    orders: number;
    addresses: number;
  };
};

type CampaignStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELED";
type Campaign = {
  id: string;
  name: string;
  message: string;
  batchSize: number;
  intervalMinutes: number;
  status: CampaignStatus;
  nextBatchAt: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  recipients: Array<{ id: string; customerName: string; phone: string; errorMessage?: string | null }>;
};

const campaignStatusLabel: Record<CampaignStatus, string> = {
  RUNNING: "Em andamento",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELED: "Cancelada"
};

export default function CustomersManagePage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [allCustomers, setAllCustomers] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [batchSize, setBatchSize] = useState(5);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [startAt, setStartAt] = useState("");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/customers?search=${encodeURIComponent(search)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });

    if (!res.ok) {
      toast.error("Falha ao carregar clientes");
      return;
    }

    setCustomers(await readApiJson<Customer[]>(res));
  }

  useEffect(() => {
    void load();
  }, [search]);

  async function loadCampaigns() {
    try {
      setCampaigns(await adminApi<Campaign[]>("/admin/whatsapp-campaigns"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar campanhas");
    }
  }

  useEffect(() => {
    void loadCampaigns();
    const timer = window.setInterval(() => void loadCampaigns(), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  async function createCampaign() {
    if (!campaignName.trim() || !campaignMessage.trim()) {
      toast.error("Informe o nome e a mensagem da campanha");
      return;
    }
    if (!allCustomers && !selectedCustomerIds.length) {
      toast.error("Selecione ao menos um cliente");
      return;
    }
    if (!consentConfirmed) {
      toast.error("Confirme que os clientes autorizaram o contato");
      return;
    }
    setSavingCampaign(true);
    try {
      await adminApi("/admin/whatsapp-campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: campaignName,
          message: campaignMessage,
          batchSize,
          intervalMinutes,
          allCustomers,
          customerIds: allCustomers ? undefined : selectedCustomerIds,
          consentConfirmed: true,
          startAt: startAt ? new Date(startAt).toISOString() : undefined
        })
      });
      toast.success("Campanha criada. O primeiro lote entrará na fila do Evolution.");
      setCampaignName("");
      setCampaignMessage("");
      setStartAt("");
      setConsentConfirmed(false);
      setSelectedCustomerIds([]);
      setShowCampaignForm(false);
      await loadCampaigns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar campanha");
    } finally {
      setSavingCampaign(false);
    }
  }

  async function changeCampaignStatus(campaign: Campaign, status: "RUNNING" | "PAUSED" | "CANCELED") {
    try {
      await adminApi(`/admin/whatsapp-campaigns/${campaign.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      toast.success(status === "RUNNING" ? "Campanha retomada" : status === "PAUSED" ? "Campanha pausada" : "Campanha cancelada");
      await loadCampaigns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar campanha");
    }
  }

  function toggleCustomer(id: string) {
    setSelectedCustomerIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function saveCustomer() {
    if (!editing) return;
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/customers/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: editing.name,
        phone: editing.phone,
        email: editing.email || null,
        address: editing.address,
        number: editing.number,
        district: editing.district,
        complement: editing.complement || null
      })
    });

    if (!res.ok) {
      const payload = await readApiJson<any>(res).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao atualizar cliente");
      return;
    }

    toast.success("Cliente atualizado");
    setEditing(null);
    await load();
  }

  async function removeCustomer(id: string) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;
    const reason = window.prompt("Motivo para arquivar este cliente:");
    if (!reason || reason.trim().length < 5) {
      if (reason !== null) toast.error("Informe um motivo com pelo menos 5 caracteres");
      return;
    }

    const res = await apiFetch(`/admin/customers/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason })
    });

    if (!res.ok) {
      const payload = await readApiJson<any>(res).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao apagar cliente");
      return;
    }

    toast.success("Cliente arquivado; histórico preservado");
    setCustomers((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Clientes Cadastrados</h1>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white" onClick={() => setShowCampaignForm((value) => !value)}>
            {showCampaignForm ? "Fechar campanha" : "Nova mensagem em massa"}
          </button>
          <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">Voltar</Link>
        </div>
      </div>

      {showCampaignForm && (
        <section className="mb-4 rounded-2xl border border-emerald-700/20 bg-white/90 p-4 dark:bg-slate-900/80">
          <h2 className="text-xl font-bold">Nova campanha pelo Evolution</h2>
          <p className="mt-1 text-sm opacity-70">Envio gradual e persistente. Você pode fechar esta página depois de iniciar.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="font-semibold">Nome da campanha</span>
              <input className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ex.: Promoção de setembro" maxLength={100} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="font-semibold">Mensagem</span>
              <textarea className="min-h-36 rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={campaignMessage} onChange={(event) => setCampaignMessage(event.target.value)} placeholder="Olá, {nome}! Temos uma novidade para você..." maxLength={4000} />
              <span className="text-xs opacity-60">Use {"{nome}"} para inserir o nome de cada cliente. {campaignMessage.length}/4000</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Pessoas por lote</span>
              <input type="number" min={1} max={20} className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value))} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-semibold">Intervalo entre lotes (minutos)</span>
              <input type="number" min={1} max={1440} className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={intervalMinutes} onChange={(event) => setIntervalMinutes(Number(event.target.value))} />
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="font-semibold">Começar em (opcional)</span>
              <input type="datetime-local" className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
            </label>
          </div>
          <div className="mt-4 rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={allCustomers} onChange={(event) => setAllCustomers(event.target.checked)} />
              Enviar para todos os clientes cadastrados com telefone válido
            </label>
            {!allCustomers && <p className="mt-2 text-sm">Selecionados: {selectedCustomerIds.length}. Marque os clientes na lista abaixo.</p>}
          </div>
          <label className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950">
            <input className="mt-1" type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
            Confirmo que estes clientes autorizaram receber mensagens desta empresa e que a campanha permite cancelamento do contato.
          </label>
          <button className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={savingCampaign} onClick={() => void createCampaign()}>
            {savingCampaign ? "Criando campanha..." : "Iniciar campanha"}
          </button>
        </section>
      )}

      <section className="mb-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Campanhas de WhatsApp</h2>
        <div className="mt-3 space-y-3">
          {!campaigns.length && <p className="text-sm opacity-70">Nenhuma campanha criada.</p>}
          {campaigns.map((campaign) => (
            <article key={campaign.id} className="rounded-xl bg-slate-100 p-3 dark:bg-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong>{campaign.name}</strong>
                  <p className="text-sm">{campaignStatusLabel[campaign.status]} · {campaign.sentCount}/{campaign.totalRecipients} enviados · {campaign.failedCount} falhas</p>
                  <p className="text-xs opacity-60">Lotes de {campaign.batchSize}, a cada {campaign.intervalMinutes} minuto(s)</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {campaign.status === "RUNNING" && <button className="rounded-lg bg-amber-500 px-3 py-2 text-xs text-white" onClick={() => void changeCampaignStatus(campaign, "PAUSED")}>Pausar</button>}
                  {campaign.status === "PAUSED" && <button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs text-white" onClick={() => void changeCampaignStatus(campaign, "RUNNING")}>Continuar</button>}
                  {(campaign.status === "RUNNING" || campaign.status === "PAUSED") && <button className="rounded-lg bg-red-600 px-3 py-2 text-xs text-white" onClick={() => {
                    if (window.confirm("Cancelar esta campanha? Os destinatários ainda pendentes não receberão a mensagem.")) void changeCampaignStatus(campaign, "CANCELED");
                  }}>Cancelar</button>}
                </div>
              </div>
              {!!campaign.recipients.length && <p className="mt-2 text-xs text-red-600">Última falha: {campaign.recipients[0].customerName} — {campaign.recipients[0].errorMessage}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <input
          className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          placeholder="Buscar por nome, telefone ou email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </section>

      <section className="mt-4 space-y-2">
        {customers.map((customer) => (
          <article key={customer.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex gap-3">
                {!allCustomers && <input aria-label={`Selecionar ${customer.name}`} type="checkbox" checked={selectedCustomerIds.includes(customer.id)} onChange={() => toggleCustomer(customer.id)} />}
                <div>
                <p className="font-semibold">{customer.name}</p>
                <p className="text-sm opacity-70">{customer.phone} {customer.email ? `| ${customer.email}` : ""}</p>
                <p className="text-xs opacity-70">
                  {customer.address}, {customer.number} - {customer.district}
                </p>
                <p className="text-xs opacity-60">Pedidos: {customer._count.orders} | Enderecos: {customer._count.addresses}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20"
                  onClick={() => setEditing(customer)}
                >
                  Editar
                </button>
                <button className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void removeCustomer(customer.id)}>
                  Apagar
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>

      {editing && (
        <section className="fixed inset-0 z-30 bg-black/50 p-3" onClick={() => setEditing(null)}>
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-xl font-semibold">Editar Cliente</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.name} onChange={(e) => setEditing((v) => (v ? { ...v, name: e.target.value } : v))} placeholder="Nome" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.phone} onChange={(e) => setEditing((v) => (v ? { ...v, phone: e.target.value } : v))} placeholder="Telefone" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" value={editing.email ?? ""} onChange={(e) => setEditing((v) => (v ? { ...v, email: e.target.value } : v))} placeholder="Email" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.address} onChange={(e) => setEditing((v) => (v ? { ...v, address: e.target.value } : v))} placeholder="Endereco" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.number} onChange={(e) => setEditing((v) => (v ? { ...v, number: e.target.value } : v))} placeholder="Numero" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.district} onChange={(e) => setEditing((v) => (v ? { ...v, district: e.target.value } : v))} placeholder="Bairro" />
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={editing.complement ?? ""} onChange={(e) => setEditing((v) => (v ? { ...v, complement: e.target.value } : v))} placeholder="Complemento" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="rounded-lg border border-black/20 px-3 py-2 text-sm dark:border-white/20" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="rounded-lg bg-ember px-3 py-2 text-sm text-white" onClick={() => void saveCustomer()}>
                Salvar
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
