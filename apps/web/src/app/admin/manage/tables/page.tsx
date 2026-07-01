"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";

type DiningArea = {
  id: string;
  name: string;
  active: boolean;
};

type RestaurantTable = {
  id: string;
  number: number;
  name?: string | null;
  seats: number;
  status: "FREE" | "OCCUPIED" | "WAITING_PAYMENT" | "RESERVED" | "CLEANING";
  active: boolean;
  qrCodeUrl: string;
  orderCount?: number;
  accountTotal?: number;
  activeSession?: {
    id: string;
    status: string;
    orderCount?: number;
    accountTotal?: number;
  } | null;
  area?: DiningArea | null;
  _count?: { orders: number };
};

const statusLabels: Record<RestaurantTable["status"], string> = {
  FREE: "Livre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Aguardando pagamento",
  RESERVED: "Reservada",
  CLEANING: "Em limpeza"
};

const statusClasses: Record<RestaurantTable["status"], string> = {
  FREE: "bg-emerald-100 text-emerald-800 border-emerald-200",
  OCCUPIED: "bg-orange-100 text-orange-800 border-orange-200",
  WAITING_PAYMENT: "bg-red-100 text-red-800 border-red-200",
  RESERVED: "bg-slate-100 text-slate-800 border-slate-200",
  CLEANING: "bg-blue-100 text-blue-800 border-blue-200"
};

export default function TablesManagePage() {
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [areaName, setAreaName] = useState("");
  const [form, setForm] = useState({ number: "", name: "", areaId: "", seats: "4" });
  const [loading, setLoading] = useState(true);
  const activeTables = useMemo(() => tables.filter((table) => table.active), [tables]);

  async function request(path: string, init?: RequestInit) {
    const token = localStorage.getItem("delivery:token");
    if (!token) {
      window.location.href = "/admin/login";
      return null;
    }
    const response = await apiFetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message ?? "Falha na requisicao");
    return payload;
  }

  async function load() {
    setLoading(true);
    try {
      const [loadedAreas, loadedTables] = await Promise.all([
        request("/admin/dining-areas"),
        request("/admin/tables")
      ]);
      setAreas(loadedAreas ?? []);
      setTables(loadedTables ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar mesas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createArea() {
    if (!areaName.trim()) return;
    try {
      await request("/admin/dining-areas", {
        method: "POST",
        body: JSON.stringify({ name: areaName.trim() })
      });
      setAreaName("");
      toast.success("Setor criado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar setor");
    }
  }

  async function createTable() {
    try {
      await request("/admin/tables", {
        method: "POST",
        body: JSON.stringify({
          number: Number(form.number),
          name: form.name || null,
          areaId: form.areaId || null,
          seats: Number(form.seats || 4)
        })
      });
      setForm({ number: "", name: "", areaId: "", seats: "4" });
      toast.success("Mesa criada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar mesa");
    }
  }

  async function updateStatus(table: RestaurantTable, status: RestaurantTable["status"]) {
    try {
      await request(`/admin/tables/${table.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar mesa");
    }
  }

  async function deactivateTable(table: RestaurantTable) {
    if (!window.confirm(`Desativar a mesa ${table.number}?`)) return;
    try {
      await request(`/admin/tables/${table.id}`, { method: "DELETE" });
      toast.success("Mesa desativada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao desativar mesa");
    }
  }

  function qrImage(url: string) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(url)}`;
  }

  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">PDV + QR Code</p>
          <h1 className="font-display text-4xl">Mesas</h1>
          <p className="text-sm opacity-70">Cadastre setores, mesas e gere o QR Code para atendimento presencial.</p>
        </div>
        <Link href="/admin" className="rounded-xl bg-ink px-3 py-2 text-white">Voltar</Link>
      </div>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
          <h2 className="text-xl font-black">Setores</h2>
          <div className="mt-3 flex gap-2">
            <input className="w-full rounded-xl border px-3 py-2" placeholder="Ex: Salão, Varanda, Área externa" value={areaName} onChange={(event) => setAreaName(event.target.value)} />
            <button className="rounded-xl bg-ember px-4 py-2 font-bold text-white" onClick={() => void createArea()}>Criar</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {areas.map((area) => (
              <span key={area.id} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold dark:bg-slate-800">{area.name}</span>
            ))}
            {!areas.length && <p className="text-sm opacity-60">Nenhum setor cadastrado.</p>}
          </div>
        </div>

        <div className="rounded-2xl border bg-white/85 p-4 dark:bg-slate-900/70">
          <h2 className="text-xl font-black">Nova mesa</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <input className="rounded-xl border px-3 py-2" placeholder="Número" inputMode="numeric" value={form.number} onChange={(event) => setForm((value) => ({ ...value, number: event.target.value }))} />
            <input className="rounded-xl border px-3 py-2" placeholder="Nome opcional" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} />
            <select className="rounded-xl border px-3 py-2" value={form.areaId} onChange={(event) => setForm((value) => ({ ...value, areaId: event.target.value }))}>
              <option value="">Sem setor</option>
              {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
            <input className="rounded-xl border px-3 py-2" placeholder="Lugares" inputMode="numeric" value={form.seats} onChange={(event) => setForm((value) => ({ ...value, seats: event.target.value }))} />
          </div>
          <button className="mt-3 w-full rounded-xl bg-ink px-4 py-3 font-bold text-white" onClick={() => void createTable()}>
            Criar mesa e gerar QR Code
          </button>
        </div>
      </section>

      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-black">Mapa de mesas</h2>
          <span className="rounded-full bg-black/5 px-3 py-1 text-sm font-bold dark:bg-white/10">{activeTables.length} mesas</span>
        </div>
        {loading ? (
          <p className="rounded-2xl border bg-white/80 p-4">Carregando...</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeTables.map((table) => (
              <article key={table.id} className={`rounded-3xl border p-4 ${statusClasses[table.status]}`}>
                {(() => {
                  const activeOrderCount = table.orderCount ?? table.activeSession?.orderCount ?? 0;
                  const activeAccountTotal = table.accountTotal ?? table.activeSession?.accountTotal ?? 0;
                  return (
                    <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold opacity-70">{table.area?.name || "Sem setor"}</p>
                    <h3 className="font-display text-4xl">Mesa {table.number}</h3>
                    <p className="font-bold">{table.name || `${table.seats} lugares`}</p>
                    <p className="mt-1 text-sm">Status: {statusLabels[table.status]}</p>
                    {!!activeOrderCount && <p className="text-sm font-bold">{activeOrderCount} pedido(s) da comanda atual</p>}
                    {!!activeAccountTotal && <p className="text-sm font-black">Conta atual: R$ {activeAccountTotal.toFixed(2).replace(".", ",")}</p>}
                  </div>
                  <img className="h-24 w-24 rounded-xl bg-white p-1" src={qrImage(table.qrCodeUrl)} alt={`QR Code mesa ${table.number}`} />
                </div>

                <div className="mt-3 rounded-2xl bg-white/70 p-3 text-xs text-slate-800">
                  <p className="font-bold">Link da mesa</p>
                  <p className="break-all">{table.qrCodeUrl}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="rounded-lg bg-ink px-3 py-2 text-white" onClick={() => {
                      void navigator.clipboard.writeText(table.qrCodeUrl);
                      toast.success("Link copiado");
                    }}>
                      Copiar link
                    </button>
                    <a className="rounded-lg border border-slate-300 px-3 py-2" href={qrImage(table.qrCodeUrl)} target="_blank" rel="noreferrer">
                      Abrir QR
                    </a>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                  {(Object.keys(statusLabels) as RestaurantTable["status"][]).map((status) => (
                    <button key={status} className="rounded-lg bg-white/70 px-2 py-2 text-slate-800" onClick={() => void updateStatus(table, status)}>
                      {statusLabels[status]}
                    </button>
                  ))}
                  <button className="rounded-lg bg-red-600 px-2 py-2 text-white" onClick={() => void deactivateTable(table)}>
                    Desativar
                  </button>
                </div>
                    </>
                  );
                })()}
              </article>
            ))}
            {!activeTables.length && <p className="rounded-2xl border bg-white/80 p-5 text-sm opacity-70 dark:bg-slate-900/70">Nenhuma mesa cadastrada ainda.</p>}
          </div>
        )}
      </section>
    </main>
  );
}
