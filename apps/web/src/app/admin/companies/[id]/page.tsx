"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CompanyForm, type CompanyFormValue } from "../../../../components/company-form";
import { adminApi, requireMaster } from "../../../../lib/admin-api";

type CompanyDetail = CompanyFormValue & {
  id: string;
  createdAt: string;
  _count: { users: number; products: number; orders: number; customers: number };
  users: Array<{ id: string; name: string; email: string; phone?: string; active: boolean }>;
};

export default function EditCompanyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [company, setCompany] = useState<CompanyDetail | null>(null);

  useEffect(() => {
    void requireMaster()
      .then(() => adminApi<CompanyDetail>(`/admin/companies/${params.id}`))
      .then(setCompany)
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Empresa não encontrada");
        router.replace("/admin/companies");
      });
  }, [params.id, router]);

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-ember">Painel master SaaS</p>
          <h1 className="font-display text-4xl">{company?.tradeName ?? "Carregando..."}</h1>
        </div>
        <Link className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20" href="/admin/companies">Voltar</Link>
      </div>

      {company && (
        <>
          <section className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            {Object.entries(company._count).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-100 p-3 text-center dark:bg-slate-800">
                <strong className="text-xl">{value}</strong><br />
                <span className="text-xs">{label}</span>
              </div>
            ))}
          </section>
          <CompanyForm
            initialValue={company}
            submitLabel="Salvar alteracoes"
            onSubmit={async (value) => {
              const updated = await adminApi<CompanyDetail>(`/admin/companies/${company.id}`, {
                method: "PATCH",
                body: JSON.stringify(value)
              });
              setCompany((current) => current ? { ...current, ...updated } : updated);
              toast.success("Empresa atualizada");
            }}
          />
        </>
      )}
    </main>
  );
}
