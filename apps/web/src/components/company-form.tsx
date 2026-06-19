"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi } from "../lib/admin-api";

export type CompanyFormValue = {
  companyName: string;
  tradeName: string;
  cnpj: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  email: string;
  logoUrl: string;
  subdomain: string;
  plan: string;
  active: boolean;
};

type Props = {
  initialValue?: Partial<CompanyFormValue>;
  includeAdmin?: boolean;
  submitLabel: string;
  onSubmit: (value: CompanyFormValue & {
    admin?: { name: string; email: string; phone: string; password: string };
  }) => Promise<void>;
};

const emptyCompany: CompanyFormValue = {
  companyName: "",
  tradeName: "",
  cnpj: "",
  phone: "",
  whatsapp: "",
  instagram: "",
  email: "",
  logoUrl: "",
  subdomain: "",
  plan: "basico",
  active: true
};

export function CompanyForm({ initialValue, includeAdmin = false, submitLabel, onSubmit }: Props) {
  const [form, setForm] = useState<CompanyFormValue>({ ...emptyCompany, ...initialValue });
  const [admin, setAdmin] = useState({ name: "", email: "", phone: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setForm({ ...emptyCompany, ...initialValue });
  }, [initialValue]);

  async function generateSubdomain() {
    if (form.tradeName.trim().length < 2) {
      toast.error("Informe primeiro o nome fantasia");
      return;
    }
    setGenerating(true);
    try {
      const result = await adminApi<{ subdomain: string }>(
        `/admin/companies/subdomain?tradeName=${encodeURIComponent(form.tradeName)}`
      );
      setForm((value) => ({ ...value, subdomain: result.subdomain }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar subdominio");
    } finally {
      setGenerating(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit({ ...form, ...(includeAdmin ? { admin } : {}) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar empresa");
    } finally {
      setSaving(false);
    }
  }

  const input = (
    field: keyof CompanyFormValue,
    label: string,
    options?: { type?: string; required?: boolean; placeholder?: string }
  ) => (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <input
        className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
        type={options?.type ?? "text"}
        required={options?.required}
        placeholder={options?.placeholder}
        value={String(form[field])}
        onChange={(event) => setForm((value) => ({ ...value, [field]: event.target.value }))}
      />
    </label>
  );

  return (
    <form className="space-y-5" onSubmit={submit}>
      <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Dados da empresa</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {input("companyName", "Razao social", { required: true })}
          {input("tradeName", "Nome fantasia", { required: true })}
          {input("cnpj", "CNPJ", { placeholder: "00.000.000/0000-00" })}
          {input("email", "Email", { type: "email" })}
          {input("phone", "Telefone")}
          {input("whatsapp", "WhatsApp")}
          {input("instagram", "Instagram", { placeholder: "@empresa" })}
          {input("logoUrl", "URL da logo", { type: "url" })}
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Plano</span>
            <select
              className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
              value={form.plan}
              onChange={(event) => setForm((value) => ({ ...value, plan: event.target.value }))}
            >
              <option value="basico">Basico</option>
              <option value="profissional">Profissional</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <label className="flex items-center gap-2 self-end rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((value) => ({ ...value, active: event.target.checked }))}
            />
            Empresa ativa
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">Subdominio</h2>
            <p className="text-sm opacity-70">Endereco publico futuro da empresa.</p>
          </div>
          <button
            type="button"
            className="rounded-xl border border-black/15 px-3 py-2 text-sm dark:border-white/20"
            onClick={() => void generateSubdomain()}
            disabled={generating}
          >
            {generating ? "Gerando..." : "Gerar automaticamente"}
          </button>
        </div>
        <input
          className="mt-3 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
          required
          value={form.subdomain}
          onChange={(event) => setForm((value) => ({
            ...value,
            subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")
          }))}
        />
        <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">
          {form.subdomain || "subdominio"}.meudelivery.com.br
        </p>
      </section>

      {includeAdmin && (
        <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
          <h2 className="text-xl font-bold">Administrador inicial</h2>
          <p className="text-sm opacity-70">Este usuario recebera acesso administrativo somente a esta empresa.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {(["name", "email", "phone", "password"] as const).map((field) => (
              <label key={field} className="grid gap-1 text-sm">
                <span className="font-semibold">
                  {{ name: "Nome", email: "Email", phone: "Telefone", password: "Senha inicial" }[field]}
                </span>
                <input
                  className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
                  required={field !== "phone"}
                  type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                  minLength={field === "password" ? 6 : undefined}
                  value={admin[field]}
                  onChange={(event) => setAdmin((value) => ({ ...value, [field]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <button
        className="w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white disabled:opacity-60"
        disabled={saving}
      >
        {saving ? "Salvando..." : submitLabel}
      </button>
    </form>
  );
}
