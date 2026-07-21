"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { CompanyForm } from "../../../../components/company-form";
import { adminApi, requireMaster } from "../../../../lib/admin-api";

export default function NewCompanyPage() {
  const router = useRouter();
  useEffect(() => {
    void requireMaster().catch(() => router.replace("/admin"));
  }, [router]);

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-ember">Painel master SaaS</p>
          <h1 className="font-display text-4xl">Nova empresa</h1>
        </div>
        <Link className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20" href="/admin/companies">Voltar</Link>
      </div>
      <CompanyForm
        includeAdmin
        submitLabel="Criar empresa e administrador"
        onSubmit={async (value) => {
          const company = await adminApi<{ id: string; businessType: string }>("/admin/companies", {
            method: "POST",
            body: JSON.stringify(value)
          });
          toast.success("Empresa e administrador criados");
          router.push(company.businessType === "IPTV" ? `/admin/apps?companyId=${company.id}` : `/admin/companies/${company.id}`);
        }}
      />
    </main>
  );
}
