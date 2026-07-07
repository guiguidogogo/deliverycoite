"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi, requireMaster } from "../../../lib/admin-api";

type Company = {
  id: string;
  companyName: string;
  tradeName: string;
  cnpj?: string | null;
  subdomain: string;
  publicUrl: string;
  plan: string;
  active: boolean;
  createdAt: string;
  _count: { users: number; products: number; orders: number };
  users: Array<{ name: string; email: string }>;
};

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await requireMaster();
      const params = new URLSearchParams({ search, status, plan });
      setCompanies(await adminApi<Company[]>(`/admin/companies?${params}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Acesso negado");
      router.replace("/admin");
    } finally {
      setLoading(false);
    }
  }, [plan, router, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function toggle(company: Company) {
    try {
      await adminApi(`/admin/companies/${company.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ active: !company.active })
      });
      toast.success(company.active ? "Empresa desativada" : "Empresa ativada");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao alterar status");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-ember">Painel master SaaS</p>
          <h1 className="font-display text-4xl">Empresas</h1>
        </div>
        <div className="flex gap-2">
          <Link className="rounded-xl bg-ink px-4 py-2 text-white" href="/admin/companies/new">Nova empresa</Link>
        </div>
      </div>

      <section className="mt-5 grid gap-2 rounded-2xl border border-black/10 bg-white/80 p-4 md:grid-cols-3 dark:border-white/10 dark:bg-slate-900/70">
        <input className="rounded-xl border px-3 py-2" placeholder="Buscar empresa, CNPJ ou subdominio" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="rounded-xl border px-3 py-2" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos os status</option>
          <option value="active">Ativas</option>
          <option value="inactive">Inativas</option>
        </select>
        <select className="rounded-xl border px-3 py-2" value={plan} onChange={(event) => setPlan(event.target.value)}>
          <option value="">Todos os planos</option>
          <option value="basico">Basico</option>
          <option value="profissional">Profissional</option>
          <option value="premium">Premium</option>
        </select>
      </section>

      <section className="mt-5 space-y-3">
        {loading && <p>Carregando empresas...</p>}
        {!loading && companies.length === 0 && (
          <div className="rounded-2xl border border-dashed p-8 text-center opacity-70">Nenhuma empresa encontrada.</div>
        )}
        {companies.map((company) => (
          <article key={company.id} className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{company.tradeName}</h2>
                  <span className={`rounded-full px-2 py-1 text-xs ${company.active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                    {company.active ? "Ativa" : "Inativa"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{company.plan}</span>
                </div>
                <p className="text-sm opacity-70">{company.companyName}</p>
                <a className="mt-1 block font-mono text-sm underline" href={company.publicUrl} target="_blank" rel="noreferrer">
                  {company.publicUrl}
                </a>
                <p className="mt-1 text-xs opacity-60">Admin: {company.users[0]?.email ?? "Nao encontrado"}</p>
              </div>
              <div className="flex gap-2">
                <button className={`rounded-xl px-3 py-2 text-sm text-white ${company.active ? "bg-red-600" : "bg-emerald-600"}`} onClick={() => void toggle(company)}>
                  {company.active ? "Desativar" : "Ativar"}
                </button>
                <Link className="rounded-xl bg-ink px-3 py-2 text-sm text-white" href={`/admin/companies/${company.id}`}>Editar</Link>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><strong>{company._count.users}</strong><br />usuarios</div>
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><strong>{company._count.products}</strong><br />produtos</div>
              <div className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><strong>{company._count.orders}</strong><br />pedidos</div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
