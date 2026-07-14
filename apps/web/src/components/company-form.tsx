"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { adminApi, getAdminToken } from "../lib/admin-api";
import { apiFetch, getBrowserRootDomain, resolveAssetUrl } from "../lib/api";

export type CompanyFormValue = {
  companyName: string;
  tradeName: string;
  cnpj: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  email: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  subdomain: string;
  plan: string;
  active: boolean;
  marketplaceVisible: boolean;
  featured: boolean;
  businessType: "FOOD" | "EVENTS" | "BARBERSHOP" | "BEAUTY_SALON" | "PHARMACY" | "MARKET" | "CLINIC" | "SERVICES" | "RAFFLE";
  category: string;
  city: string;
  isOpen: boolean;
  deliveryFee: number;
  deliveryTimeMin: number;
  rating: number;
  mercadoPagoEnabled: boolean;
  mercadoPagoPublicKey: string;
  mercadoPagoAccessToken: string;
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
  faviconUrl: "",
  primaryColor: "#e76f51",
  secondaryColor: "#7ebc59",
  subdomain: "",
  plan: "basico",
  active: true,
  marketplaceVisible: true,
  featured: false,
  businessType: "FOOD",
  category: "Lanches",
  city: "Conceição do Coité",
  isOpen: true,
  deliveryFee: 5,
  deliveryTimeMin: 35,
  rating: 5,
  mercadoPagoEnabled: false,
  mercadoPagoPublicKey: "",
  mercadoPagoAccessToken: ""
};
export function CompanyForm({ initialValue, includeAdmin = false, submitLabel, onSubmit }: Props) {
  const [form, setForm] = useState<CompanyFormValue>({ ...emptyCompany, ...initialValue });
  const [admin, setAdmin] = useState({ name: "", email: "", phone: "", password: "" });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [subdomainEdited, setSubdomainEdited] = useState(false);
  const [uploading, setUploading] = useState<"logoUrl" | "faviconUrl" | null>(null);
  const rootDomain = getBrowserRootDomain();

  useEffect(() => {
    setForm({ ...emptyCompany, ...initialValue });
  }, [initialValue]);

  useEffect(() => {
    if (!includeAdmin || subdomainEdited || form.tradeName.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      void generateSubdomain();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form.tradeName, includeAdmin, subdomainEdited]);

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

  async function uploadImage(field: "logoUrl" | "faviconUrl", file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5 MB");
      return;
    }

    const token = getAdminToken();
    if (!token) {
      toast.error("Sessão expirada");
      return;
    }

    setUploading(field);
    try {
      const data = new FormData();
      data.append("image", file);
      const response = await apiFetch(`/admin/companies/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data
      }, { json: false, skipSubdomain: true });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Falha ao enviar imagem");
      setForm((value) => ({ ...value, [field]: result.url }));
      toast.success(field === "logoUrl" ? "Logo enviada" : "Favicon enviado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    } finally {
      setUploading(null);
    }
  }

  const imageUpload = (
    field: "logoUrl" | "faviconUrl",
    label: string,
    help: string,
    rounded = false
  ) => (
    <div className="rounded-2xl border border-black/10 p-4 dark:border-white/20">
      <div className="flex items-center gap-4">
        <div className={`grid h-20 w-20 shrink-0 place-items-center overflow-hidden border bg-slate-50 text-xs text-slate-400 ${rounded ? "rounded-full" : "rounded-2xl"}`}>
          {form[field] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resolveAssetUrl(form[field])} alt={label} className="h-full w-full object-cover" />
          ) : (
            "Sem imagem"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{label}</p>
          <p className="mt-1 text-xs opacity-60">{help}</p>
          <label className="mt-3 inline-flex cursor-pointer rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white dark:bg-ember">
            {uploading === field ? "Enviando..." : "Escolher arquivo"}
            <input
              className="hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              disabled={uploading !== null}
              onChange={(event) => {
                void uploadImage(field, event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {form[field] && (
            <button
              type="button"
              className="ml-2 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600"
              onClick={() => setForm((value) => ({ ...value, [field]: "" }))}
            >
              Remover
            </button>
          )}
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold opacity-60">Ou informar URL manualmente</summary>
        <input
          className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          type="text"
          placeholder="https://... ou /api/marketplace/assets/..."
          value={form[field]}
          onChange={(event) => setForm((value) => ({ ...value, [field]: event.target.value }))}
        />
      </details>
    </div>
  );

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
    <form className="space-y-5" onSubmit={submit} noValidate>
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
          {input("primaryColor", "Cor primaria", { type: "color" })}
          {input("secondaryColor", "Cor secundaria", { type: "color" })}
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
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {imageUpload("logoUrl", "Logo da empresa", "PNG, JPG, WebP, GIF ou SVG. Máximo de 5 MB.")}
          {imageUpload("faviconUrl", "Ícone da loja", "Imagem quadrada usada como ícone da página.", true)}
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Marketplace regional</h2>
        <p className="text-sm opacity-70">Informações exibidas no catálogo público do HubRegional.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Categoria</span>
            <select
              className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
              value={form.category}
              onChange={(event) => setForm((value) => ({
                ...value,
                category: event.target.value,
                businessType: event.target.value === "Rifas" ? "RAFFLE" : value.businessType
              }))}
            >
              {["Lanches", "Pizzaria", "Açaí", "Marmitas", "Sushi", "Conveniência", "Farmácia", "Mercado", "Rifas"].map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Tipo de negocio</span>
            <select
              className="rounded-xl border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
              value={form.businessType}
              onChange={(event) => setForm((value) => ({
                ...value,
                businessType: event.target.value as CompanyFormValue["businessType"],
                category: event.target.value === "RAFFLE" ? "Rifas" : value.category
              }))}
            >
              <option value="FOOD">Delivery / Restaurante</option>
              <option value="EVENTS">Shows e Eventos</option>
              <option value="RAFFLE">Rifas</option>
              <option value="BARBERSHOP">Barbearia</option>
              <option value="BEAUTY_SALON">Salao de beleza</option>
              <option value="PHARMACY">Farmacia</option>
              <option value="MARKET">Mercado</option>
              <option value="CLINIC">Clinica</option>
              <option value="SERVICES">Servicos</option>
            </select>
          </label>
          {input("city", "Cidade", { required: true })}
          {input("deliveryFee", "Taxa de entrega (R$)", { type: "number", required: true })}
          {input("deliveryTimeMin", "Tempo médio (minutos)", { type: "number", required: true })}
          {input("rating", "Avaliação inicial", { type: "number", required: true })}
          <div className="grid gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
              <input
                type="checkbox"
                checked={form.marketplaceVisible}
                onChange={(event) => setForm((value) => ({ ...value, marketplaceVisible: event.target.checked }))}
              />
              Exibir no marketplace
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) => setForm((value) => ({ ...value, featured: event.target.checked }))}
              />
              Empresa em destaque
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
              <input
                type="checkbox"
                checked={form.isOpen}
                onChange={(event) => setForm((value) => ({ ...value, isOpen: event.target.checked }))}
              />
              Loja aberta no marketplace
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">Subdomínio</h2>
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
          onInput={() => setSubdomainEdited(true)}
        />
        <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">
          https://{form.subdomain || "subdominio"}.{rootDomain}
        </p>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-5 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Mercado Pago</h2>
        <p className="text-sm opacity-70">Credenciais e ativacao do pagamento online desta empresa.</p>
        <div className="mt-4 grid gap-3">
          <label className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
            <input
              type="checkbox"
              checked={form.mercadoPagoEnabled}
              onChange={(event) => setForm((value) => ({ ...value, mercadoPagoEnabled: event.target.checked }))}
            />
            Ativar Mercado Pago no checkout
          </label>
          {input("mercadoPagoPublicKey", "Public Key", { placeholder: "APP_USR-..." })}
          {input("mercadoPagoAccessToken", "Access Token", { type: "password", placeholder: "APP_USR-..." })}
        </div>
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
        disabled={saving || uploading !== null}
      >
        {saving ? "Salvando..." : submitLabel}
      </button>
    </form>
  );
}
