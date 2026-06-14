"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";

type Coupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: string;
  minOrder?: string | null;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  maxUsesPerDay?: number | null;
  _count?: { redemptions: number };
  active: boolean;
  expiresAt?: string | null;
};

export default function CouponsManagePage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState({
    code: "",
    type: "PERCENT",
    value: "10",
    minOrder: "",
    maxUses: "",
    maxUsesPerCustomer: "",
    maxUsesPerDay: "",
    expiresAt: ""
  });
  const [banner, setBanner] = useState({
    imageUrl: "",
    title: "PROMO DA NOITE",
    text: "Confira nossos cupons e promocoes"
  });
  const [bannerFile, setBannerFile] = useState<File | null>(null);

  async function load() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/coupons`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      toast.error("Falha ao carregar cupons");
      return;
    }

    setCoupons(await res.json());
  }

  useEffect(() => {
    void load();
    void fetch(`${API_URL}/settings`)
      .then((response) => response.json())
      .then((settings) =>
        setBanner({
          imageUrl: settings.promoBannerImageUrl ?? "",
          title: settings.promoBannerTitle ?? "PROMO DA NOITE",
          text: settings.promoBannerText ?? "Confira nossos cupons e promocoes"
        })
      );
  }, []);

  async function saveBanner() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    try {
      let imageUrl = banner.imageUrl.trim();
      if (bannerFile) {
        const data = new FormData();
        data.append("image", bannerFile);
        const upload = await fetch(`${API_URL}/admin/uploads/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: data
        });
        const uploadPayload = await upload.json().catch(() => ({}));
        if (!upload.ok) {
          throw new Error(uploadPayload.message ?? "Falha ao enviar imagem");
        }
        imageUrl =
          uploadPayload.absoluteUrl ??
          `${window.location.origin}${uploadPayload.url}`;
      }

      const response = await fetch(`${API_URL}/admin/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          promoBannerImageUrl: imageUrl || null,
          promoBannerTitle: banner.title.trim(),
          promoBannerText: banner.text.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message ?? "Falha ao salvar banner");
      }

      setBanner((value) => ({
        ...value,
        imageUrl: payload.promoBannerImageUrl ?? ""
      }));
      setBannerFile(null);
      toast.success("Banner promocional atualizado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar banner");
    }
  }

  async function createCoupon() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/coupons`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: form.code.toUpperCase().trim(),
        type: form.type,
        value: Number(form.value),
        minOrder: form.minOrder ? Number(form.minOrder) : undefined,
        maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        maxUsesPerCustomer: form.maxUsesPerCustomer ? Number(form.maxUsesPerCustomer) : undefined,
        maxUsesPerDay: form.maxUsesPerDay ? Number(form.maxUsesPerDay) : undefined,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
        active: true
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.message ?? "Falha ao criar cupom");
      return;
    }

    toast.success("Cupom criado");
    setForm({
      code: "",
      type: "PERCENT",
      value: "10",
      minOrder: "",
      maxUses: "",
      maxUsesPerCustomer: "",
      maxUsesPerDay: "",
      expiresAt: ""
    });
    await load();
  }

  async function toggleCoupon(coupon: Coupon) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/coupons/${coupon.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active: !coupon.active })
    });

    if (!res.ok) {
      toast.error("Falha ao atualizar cupom");
      return;
    }

    await load();
  }

  async function deleteCoupon(id: string) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/coupons/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      toast.error("Falha ao apagar cupom");
      return;
    }

    setCoupons((prev) => prev.filter((item) => item.id !== id));
    toast.success("Cupom apagado");
  }

  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-4xl">Cupons de Desconto</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="mb-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-lg font-semibold">Imagem promocional do cliente</h2>
        <p className="mt-1 text-sm opacity-70">
          Edite a imagem e o texto que aparecem no topo do cardapio.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="relative min-h-40 overflow-hidden rounded-xl bg-gradient-to-r from-ember to-lime">
            {banner.imageUrl && (
              <Image
                src={banner.imageUrl}
                alt="Banner promocional"
                fill
                unoptimized
                className="object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 to-slate-950/20" />
            <div className="absolute inset-0 flex flex-col justify-end p-4 text-white">
              <p className="font-display text-2xl">{banner.title || "PROMO"}</p>
              <p className="text-sm">{banner.text}</p>
            </div>
          </div>
          <div className="space-y-2">
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Titulo da promocao"
              value={banner.title}
              onChange={(event) => setBanner((value) => ({ ...value, title: event.target.value }))}
            />
            <textarea
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="Texto da promocao ou cupom"
              value={banner.text}
              onChange={(event) => setBanner((value) => ({ ...value, text: event.target.value }))}
            />
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              type="url"
              placeholder="URL da imagem"
              value={banner.imageUrl}
              onChange={(event) => setBanner((value) => ({ ...value, imageUrl: event.target.value }))}
            />
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2 dark:border-white/20"
              type="file"
              accept="image/*"
              onChange={(event) => setBannerFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="w-full rounded-xl bg-ink px-3 py-2 text-white dark:bg-ember"
              onClick={() => void saveBanner()}
            >
              Salvar imagem promocional
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-lg font-semibold">Novo cupom</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Codigo (ex: CLIENTE10)" value={form.code} onChange={(e) => setForm((v) => ({ ...v, code: e.target.value }))} />
          <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={form.type} onChange={(e) => setForm((v) => ({ ...v, type: e.target.value }))}>
            <option value="PERCENT">Percentual</option>
            <option value="FIXED">Valor fixo</option>
          </select>
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Valor" value={form.value} onChange={(e) => setForm((v) => ({ ...v, value: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Pedido minimo" value={form.minOrder} onChange={(e) => setForm((v) => ({ ...v, minOrder: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Limite total de usos" value={form.maxUses} onChange={(e) => setForm((v) => ({ ...v, maxUses: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Usos por cliente" value={form.maxUsesPerCustomer} onChange={(e) => setForm((v) => ({ ...v, maxUsesPerCustomer: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Usos por cliente ao dia" value={form.maxUsesPerDay} onChange={(e) => setForm((v) => ({ ...v, maxUsesPerDay: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" type="date" value={form.expiresAt} onChange={(e) => setForm((v) => ({ ...v, expiresAt: e.target.value }))} />
          <button className="rounded-xl bg-ember px-3 py-2 text-white md:col-span-2" onClick={() => void createCoupon()}>
            Criar cupom
          </button>
        </div>
      </section>

      <section className="mt-4 space-y-2">
        {coupons.map((coupon) => (
          <article key={coupon.id} className="rounded-xl border border-black/10 bg-white/80 p-3 dark:border-white/10 dark:bg-slate-900/70">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{coupon.code}</p>
                <p className="text-sm opacity-70">
                  {coupon.type === "PERCENT" ? `${Number(coupon.value)}%` : `R$ ${Number(coupon.value).toFixed(2)}`} 
                  {coupon.minOrder ? ` | Min: R$ ${Number(coupon.minOrder).toFixed(2)}` : ""}
                </p>
                <p className="text-xs opacity-60">
                  Usado: {coupon._count?.redemptions ?? 0}
                  {coupon.maxUses ? ` / ${coupon.maxUses}` : ""}
                  {coupon.maxUsesPerCustomer ? ` | Cliente: ${coupon.maxUsesPerCustomer}x` : ""}
                  {coupon.maxUsesPerDay ? ` | Dia: ${coupon.maxUsesPerDay}x` : ""}
                </p>
                <p className="text-xs opacity-60">
                  {coupon.expiresAt ? `Expira em ${new Date(coupon.expiresAt).toLocaleDateString("pt-BR")}` : "Sem validade"}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="rounded-lg border border-black/20 px-2 py-1 text-xs dark:border-white/20" onClick={() => void toggleCoupon(coupon)}>
                  {coupon.active ? "Desativar" : "Ativar"}
                </button>
                <button className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white" onClick={() => void deleteCoupon(coupon.id)}>
                  Apagar
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
