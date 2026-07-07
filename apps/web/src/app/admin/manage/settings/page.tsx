"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL, apiFetch, resolveAssetUrl } from "../../../../lib/api";
import { LocationPicker } from "../../../../components/location-picker";
import { printTestReceipt, testReceiptHtml } from "../../../../lib/browser-print";
import { findLocalPrinters, printAgentInstallUrl, printHtmlWithAgent } from "../../../../lib/qz-print";

export default function SettingsManagePage() {
  const [form, setForm] = useState({
    companyName: "",
    logoUrl: "",
    faviconUrl: "",
    primaryColor: "#e76f51",
    secondaryColor: "#7ebc59",
    whatsappNumber: "",
    deliveryPhoneNumber: "",
    deliveryFee: "5",
    storeLatitude: null as number | null,
    storeLongitude: null as number | null,
    deliveryFeeTiers: [] as Array<{ maxDistanceKm: string; fee: string }>,
    openTime: "18:00",
    closeTime: "23:59",
    autoMessage: "",
    promoBannerTitle: "",
    promoBannerText: "",
    pixKey: "",
    pixQrCodeUrl: "",
    menuiaApiKey: "",
    menuiaStoreId: "",
    menuiaEnabled: false,
    mercadoPagoEnabled: false,
    mercadoPagoPublicKey: "",
    mercadoPagoAccessToken: "",
    whatsappOnReceived: true,
    whatsappOnPreparing: true,
    whatsappOnOutForDelivery: true,
    whatsappOnDelivered: true,
    whatsappOnFinished: true,
    whatsappOnCanceled: true,
    whatsappOnPaymentConfirmed: true,
    printerEnabled: false,
    printerName: "",
    printerPaperWidth: 58,
    printerAutoPrint: false
  });
  const [printers, setPrinters] = useState<string[]>([]);
  const [agentStatus, setAgentStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [printerAgent, setPrinterAgent] = useState({
    enabled: false,
    hasToken: false,
    lastSeenAt: null as string | null
  });
  const [newPrinterToken, setNewPrinterToken] = useState("");
  useEffect(() => {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    void apiFetch(`/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((res) => res.json())
      .then((data) => {
        setForm({
          companyName: data.companyName ?? "",
          logoUrl: data.logoUrl ?? "",
          faviconUrl: data.faviconUrl ?? "",
          primaryColor: data.primaryColor ?? "#e76f51",
          secondaryColor: data.secondaryColor ?? "#7ebc59",
          whatsappNumber: data.whatsappNumber ?? "",
          deliveryPhoneNumber: data.deliveryPhoneNumber ?? "",
          deliveryFee: String(Number(data.deliveryFee ?? 0)),
          storeLatitude: data.storeLatitude ?? null,
          storeLongitude: data.storeLongitude ?? null,
          deliveryFeeTiers: (data.deliveryFeeTiers ?? []).map((tier: any) => ({
            maxDistanceKm: String(tier.maxDistanceKm),
            fee: String(Number(tier.fee))
          })),
          openTime: data.openTime ?? "18:00",
          closeTime: data.closeTime ?? "23:59",
          autoMessage: data.autoMessage ?? "",
          promoBannerTitle: data.promoBannerTitle ?? "",
          promoBannerText: data.promoBannerText ?? "",
          pixKey: data.pixKey ?? "",
          pixQrCodeUrl: data.pixQrCodeUrl ?? "",
          menuiaApiKey: data.menuiaApiKey ?? "",
          menuiaStoreId: data.menuiaStoreId ?? "",
          menuiaEnabled: data.menuiaEnabled ?? false,
          mercadoPagoEnabled: data.mercadoPagoEnabled ?? false,
          mercadoPagoPublicKey: data.mercadoPagoPublicKey ?? "",
          mercadoPagoAccessToken: data.mercadoPagoAccessToken ?? "",
          whatsappOnReceived: data.whatsappOnReceived ?? true,
          whatsappOnPreparing: data.whatsappOnPreparing ?? true,
          whatsappOnOutForDelivery: data.whatsappOnOutForDelivery ?? true,
          whatsappOnDelivered: data.whatsappOnDelivered ?? true,
          whatsappOnFinished: data.whatsappOnFinished ?? true,
          whatsappOnCanceled: data.whatsappOnCanceled ?? true,
          whatsappOnPaymentConfirmed: data.whatsappOnPaymentConfirmed ?? true,
          printerEnabled: data.printerEnabled ?? false,
          printerName: data.printerName ?? "",
          printerPaperWidth: data.printerPaperWidth === 80 ? 80 : 58,
          printerAutoPrint: data.printerAutoPrint ?? false
        });
      });

    void apiFetch(`/admin/printer-agent`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setPrinterAgent({
            enabled: Boolean(data.enabled),
            hasToken: Boolean(data.hasToken),
            lastSeenAt: data.lastSeenAt ?? null
          });
        }
      });

  }, []);

  async function save() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...form,
        deliveryFee: Number(form.deliveryFee),
        deliveryFeeTiers: form.deliveryFeeTiers
          .filter((tier) => tier.maxDistanceKm.trim() !== "" && tier.fee.trim() !== "")
          .map((tier) => ({
            maxDistanceKm: Number(tier.maxDistanceKm),
            fee: Number(tier.fee)
          }))
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      const firstIssue = Array.isArray(payload.issues) ? payload.issues[0] : null;
      const field = Array.isArray(firstIssue?.path) ? firstIssue.path.join(".") : "";
      toast.error(firstIssue?.message ? `${field ? `${field}: ` : ""}${firstIssue.message}` : payload.message ?? "Falha ao salvar configuracoes");
      return;
    }

    toast.success("Configuracoes salvas");
  }

  async function searchPrinters() {
    setAgentStatus("connecting");
    try {
      const found = await findLocalPrinters();
      setPrinters(found);
      setAgentStatus("connected");
      if (!form.printerName && found.length === 1) {
        setForm((value) => ({ ...value, printerName: found[0] }));
      }
      toast.success(`${found.length} impressora(s) encontrada(s)`);
    } catch {
      setAgentStatus("error");
      toast.error("QZ Tray não está instalado ou não está aberto");
    }
  }

  async function testPrinter() {
    if (form.printerName) {
      try {
        await printHtmlWithAgent(
          form.printerName,
          testReceiptHtml(form.companyName),
          form.printerPaperWidth === 80 ? 80 : 58
        );
        toast.success("Teste enviado para a impressora");
        return;
      } catch {
        toast.error("Nao foi possivel usar o agente. Abrindo impressao manual.");
      }
    }
    printTestReceipt(form.companyName, form.printerPaperWidth === 80 ? 80 : 58);
  }

  async function testMenuia() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/integrations/menuia/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      toast.error(payload.message ?? "Teste Menuia falhou");
      return;
    }

    toast.success(payload.message ?? "Menuia conectado com sucesso");
  }

  function locateStore() {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada");
      return;
    }

    if (typeof window !== "undefined" && !window.isSecureContext) {
      toast.error("O navegador bloqueia a localizacao em HTTP. Use HTTPS ou preencha latitude/longitude manualmente.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((value) => ({
          ...value,
          storeLatitude: position.coords.latitude,
          storeLongitude: position.coords.longitude
        }));
        toast.success("Localizacao da loja encontrada");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("Permissao de localizacao negada no navegador");
          return;
        }
        if (error.code === error.TIMEOUT) {
          toast.error("Tempo esgotado ao buscar a localizacao");
          return;
        }
        toast.error("Nao foi possivel obter a localizacao. Preencha as coordenadas manualmente.");
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
    );
  }

  async function togglePrinterAgent(enabled: boolean) {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/printer-agent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(payload.message ?? "Falha ao atualizar agente de impressao");
      return;
    }
    setPrinterAgent({
      enabled: Boolean(payload.enabled),
      hasToken: Boolean(payload.hasToken),
      lastSeenAt: payload.lastSeenAt ?? null
    });
    toast.success(enabled ? "Agente de impressao ativado" : "Agente de impressao desativado");
  }

  async function generatePrinterToken() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await apiFetch(`/admin/printer-agent/token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(payload.message ?? "Falha ao gerar token");
      return;
    }
    setNewPrinterToken(payload.token ?? "");
    setPrinterAgent((current) => ({ ...current, enabled: true, hasToken: true }));
    if (payload.token) {
      await navigator.clipboard.writeText(payload.token).catch(() => undefined);
      toast.success("Token gerado e copiado. Cole no HubRegional Printer Agent.");
    }
  }

  function updateCoordinate(field: "storeLatitude" | "storeLongitude", value: string) {
    setForm((current) => ({
      ...current,
      [field]: value.trim() === "" ? null : Number(value)
    }));
  }

  function addDeliveryTier() {
    setForm((value) => ({
      ...value,
      deliveryFeeTiers: [...value.deliveryFeeTiers, { maxDistanceKm: "", fee: "" }]
    }));
  }

  async function uploadBrandImage(field: "logoUrl" | "faviconUrl", file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5 MB");
      return;
    }

    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    try {
      const data = new FormData();
      data.append("image", file);
      const response = await apiFetch(
        "/admin/companies/upload",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: data
        },
        { json: false, skipSubdomain: true }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message ?? "Falha ao enviar imagem");
      setForm((value) => ({ ...value, [field]: result.url }));
      toast.success(field === "logoUrl" ? "Logo enviada" : "Ícone enviado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar imagem");
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-4xl">Configuracoes</h1>
        <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
          Voltar
        </Link>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-3 text-xl font-bold">Configurações Gerais</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Nome da empresa" value={form.companyName} onChange={(e) => setForm((v) => ({ ...v, companyName: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="WhatsApp Loja" value={form.whatsappNumber} onChange={(e) => setForm((v) => ({ ...v, whatsappNumber: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="WhatsApp Motoboy" value={form.deliveryPhoneNumber} onChange={(e) => setForm((v) => ({ ...v, deliveryPhoneNumber: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Taxa de entrega" value={form.deliveryFee} onChange={(e) => setForm((v) => ({ ...v, deliveryFee: e.target.value }))} />
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Cor principal</span>
            <input className="h-11 rounded-xl border border-black/10 bg-transparent px-2 py-2 dark:border-white/20" type="color" value={form.primaryColor} onChange={(e) => setForm((v) => ({ ...v, primaryColor: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold">Cor secundaria</span>
            <input className="h-11 rounded-xl border border-black/10 bg-transparent px-2 py-2 dark:border-white/20" type="color" value={form.secondaryColor} onChange={(e) => setForm((v) => ({ ...v, secondaryColor: e.target.value }))} />
          </label>
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Horario abertura" value={form.openTime} onChange={(e) => setForm((v) => ({ ...v, openTime: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Horario fechamento" value={form.closeTime} onChange={(e) => setForm((v) => ({ ...v, closeTime: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Chave PIX" value={form.pixKey} onChange={(e) => setForm((v) => ({ ...v, pixKey: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="URL QR Code PIX" value={form.pixQrCodeUrl} onChange={(e) => setForm((v) => ({ ...v, pixQrCodeUrl: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Titulo do banner promocional" value={form.promoBannerTitle} onChange={(e) => setForm((v) => ({ ...v, promoBannerTitle: e.target.value }))} />
          <textarea className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Texto do banner promocional" value={form.promoBannerText} onChange={(e) => setForm((v) => ({ ...v, promoBannerText: e.target.value }))} />
          <textarea className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Mensagem automatica" value={form.autoMessage} onChange={(e) => setForm((v) => ({ ...v, autoMessage: e.target.value }))} />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-black/10 p-4 dark:border-white/20">
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-slate-50 text-xs text-slate-400">
                {form.logoUrl ? <img src={resolveAssetUrl(form.logoUrl)} alt="Logo da empresa" className="h-full w-full object-contain p-1" /> : "Sem logo"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Logo da empresa</p>
                <p className="mt-1 text-xs opacity-60">A vitrine p?blica usa esta marca.</p>
                <label className="mt-3 inline-flex cursor-pointer rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white dark:bg-ember">
                  Escolher arquivo
                  <input className="hidden" type="file" accept="image/*" onChange={(event) => { void uploadBrandImage("logoUrl", event.target.files?.[0]); event.target.value = ""; }} />
                </label>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold opacity-60">Ou informar URL manualmente</summary>
              <input className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20" placeholder="https://..." value={form.logoUrl} onChange={(e) => setForm((v) => ({ ...v, logoUrl: e.target.value }))} />
            </details>
          </div>

          <div className="rounded-2xl border border-black/10 p-4 dark:border-white/20">
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border bg-slate-50 text-xs text-slate-400">
                {form.faviconUrl ? <img src={resolveAssetUrl(form.faviconUrl)} alt="?cone da loja" className="h-full w-full object-contain p-1" /> : "Sem ?cone"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">?cone / favicon</p>
                <p className="mt-1 text-xs opacity-60">Aparece na aba do navegador e no acesso mobile.</p>
                <label className="mt-3 inline-flex cursor-pointer rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white dark:bg-ember">
                  Escolher arquivo
                  <input className="hidden" type="file" accept="image/*" onChange={(event) => { void uploadBrandImage("faviconUrl", event.target.files?.[0]); event.target.value = ""; }} />
                </label>
              </div>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold opacity-60">Ou informar URL manualmente</summary>
              <input className="mt-2 w-full rounded-xl border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20" placeholder="https://..." value={form.faviconUrl} onChange={(e) => setForm((v) => ({ ...v, faviconUrl: e.target.value }))} />
            </details>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Previa da vitrine</h2>
        <p className="mt-1 text-sm opacity-70">Veja aqui como a loja vai aparecer para o cliente antes de salvar.</p>
        <div
          className="mt-4 overflow-hidden rounded-3xl border p-4 text-white shadow-lg"
          style={{ background: `linear-gradient(135deg, ${form.primaryColor} 0%, ${form.secondaryColor} 100%)` }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-white/15">
                {form.logoUrl ? (
                  <img src={resolveAssetUrl(form.logoUrl)} alt="Logo da loja" className="h-full w-full object-contain p-1" />
                ) : (
                  <span className="text-xs font-bold">LOGO</span>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/75">{form.promoBannerTitle || "Sua loja"}</p>
                <h3 className="text-2xl font-black leading-tight">{form.companyName || "Nome da empresa"}</h3>
                <p className="mt-1 max-w-xl text-sm text-white/85">{form.promoBannerText || "Escreva aqui a mensagem principal da vitrine para chamar aten??o do cliente."}</p>
              </div>
            </div>
            <div className="hidden rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-bold md:block">
              {form.faviconUrl ? "Favicon ativo" : "Sem favicon"}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-xs uppercase tracking-widest text-white/70">Contato</p>
              <p className="mt-1 font-semibold">{form.whatsappNumber || "WhatsApp da loja"}</p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-xs uppercase tracking-widest text-white/70">Categoria</p>
              <p className="mt-1 font-semibold">{form.companyName ? form.companyName : "Lanchonete / Delivery"}</p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3">
              <p className="text-xs uppercase tracking-widest text-white/70">Destaque</p>
              <p className="mt-1 font-semibold">{form.autoMessage || "Promo??es e novidades em destaque"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="text-xl font-bold">Frete por distancia</h2>
        <p className="mt-1 text-sm opacity-70">
          Informe o local da loja e crie faixas como: ate 3 km por R$ 3,00 e ate 5 km por R$ 10,00.
        </p>

        <button
          type="button"
          className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white"
          onClick={locateStore}
        >
          Usar localizacao atual da loja
        </button>

        <p className="mt-2 text-xs opacity-60">
          Em endereco HTTP o navegador pode bloquear a localizacao atual. Se isso acontecer, informe as coordenadas
          manualmente ou acesse pelo dominio com HTTPS.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
            type="number"
            step="0.000001"
            min="-90"
            max="90"
            placeholder="Latitude da loja"
            value={form.storeLatitude ?? ""}
            onChange={(event) => updateCoordinate("storeLatitude", event.target.value)}
          />
          <input
            className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
            type="number"
            step="0.000001"
            min="-180"
            max="180"
            placeholder="Longitude da loja"
            value={form.storeLongitude ?? ""}
            onChange={(event) => updateCoordinate("storeLongitude", event.target.value)}
          />
          <button
            type="button"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/20"
            onClick={() => setForm((value) => ({ ...value, storeLatitude: null, storeLongitude: null }))}
          >
            Limpar
          </button>
        </div>

        {form.storeLatitude !== null && form.storeLongitude !== null && (
          <div className="mt-3">
            <LocationPicker
              value={{
                latitude: form.storeLatitude,
                longitude: form.storeLongitude
              }}
              onChange={(location) =>
                setForm((value) => ({
                  ...value,
                  storeLatitude: location.latitude,
                  storeLongitude: location.longitude
                }))
              }
            />
          </div>
        )}

        <div className="mt-4 space-y-2">
          {form.deliveryFeeTiers.map((tier, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                type="number"
                min="0.1"
                step="0.1"
                placeholder="Ate quantos km"
                value={tier.maxDistanceKm}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    deliveryFeeTiers: value.deliveryFeeTiers.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, maxDistanceKm: event.target.value } : item
                    )
                  }))
                }
              />
              <input
                className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                type="number"
                min="0"
                step="0.01"
                placeholder="Valor do frete"
                value={tier.fee}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    deliveryFeeTiers: value.deliveryFeeTiers.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, fee: event.target.value } : item
                    )
                  }))
                }
              />
              <button
                type="button"
                className="rounded-xl bg-red-600 px-3 py-2 text-white"
                onClick={() =>
                  setForm((value) => ({
                    ...value,
                    deliveryFeeTiers: value.deliveryFeeTiers.filter((_, itemIndex) => itemIndex !== index)
                  }))
                }
              >
                Remover
              </button>
            </div>
          ))}
          <button
            type="button"
            className="rounded-xl border border-black/10 px-4 py-2 text-sm dark:border-white/20"
            onClick={addDeliveryTier}
          >
            Adicionar faixa
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-1 text-xl font-bold">Mercado Pago</h2>
        <p className="mb-3 text-sm opacity-70">
          Configure as credenciais da conta Mercado Pago desta loja para receber pagamentos online.
        </p>
        <label className="mb-3 flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
          <input
            type="checkbox"
            checked={form.mercadoPagoEnabled}
            onChange={(e) => setForm((v) => ({ ...v, mercadoPagoEnabled: e.target.checked }))}
          />
          Ativar Mercado Pago no checkout da loja
        </label>
        <div className="grid grid-cols-1 gap-2">
          <label>
            <span className="mb-1 block text-xs font-semibold">Public Key</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="APP_USR-..."
              value={form.mercadoPagoPublicKey}
              onChange={(e) => setForm((v) => ({ ...v, mercadoPagoPublicKey: e.target.value }))}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">Access Token</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              placeholder="APP_USR-..."
              type="password"
              value={form.mercadoPagoAccessToken}
              onChange={(e) => setForm((v) => ({ ...v, mercadoPagoAccessToken: e.target.value }))}
            />
          </label>
        </div>
        <p className="mt-2 text-xs opacity-70">
          Essas chaves ficam vinculadas apenas à empresa logada e não aparecem para outras lojas.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-3 text-xl font-bold">Integração Menuia</h2>
        <div className="mb-3 flex items-center gap-2">
          <input 
            type="checkbox" 
            id="menuiaEnabled" 
            checked={form.menuiaEnabled} 
            onChange={(e) => setForm((v) => ({ ...v, menuiaEnabled: e.target.checked }))}
            className="h-4 w-4"
          />
          <label htmlFor="menuiaEnabled">Ativar integração com Menuia</label>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="AUTHKEY" value={form.menuiaApiKey} onChange={(e) => setForm((v) => ({ ...v, menuiaApiKey: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="APPKEY" value={form.menuiaStoreId} onChange={(e) => setForm((v) => ({ ...v, menuiaStoreId: e.target.value }))} />
        </div>
        <button className="mt-3 rounded-xl bg-ink px-4 py-2 text-sm text-white" onClick={() => void testMenuia()}>
          Testar conexao Menuia
        </button>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-1 text-xl font-bold">Mensagens por etapa</h2>
        <p className="mb-3 text-sm opacity-70">Desative as etapas que não devem consumir envios do WhatsApp.</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {[
            ["whatsappOnReceived", "Recebido"],
            ["whatsappOnPreparing", "Em preparo"],
            ["whatsappOnOutForDelivery", "Saiu para entrega"],
            ["whatsappOnDelivered", "Entregue"],
            ["whatsappOnFinished", "Finalizado"],
            ["whatsappOnCanceled", "Cancelado"],
            ["whatsappOnPaymentConfirmed", "Pagamento confirmado"]
          ].map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
              <input
                type="checkbox"
                checked={Boolean(form[field as keyof typeof form])}
                onChange={(e) => setForm((value) => ({ ...value, [field]: e.target.checked }))}
              />
              Enviar ao marcar: {label}
            </label>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wide">Recomendado</p>
            <h2 className="text-xl font-black">HubRegional Printer Agent</h2>
            <p className="mt-1 max-w-2xl text-sm opacity-80">
              Programa Windows local para imprimir pedidos automaticamente sem depender do navegador.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 font-semibold dark:bg-black/20">
            <input
              type="checkbox"
              checked={printerAgent.enabled}
              onChange={(event) => void togglePrinterAgent(event.target.checked)}
            />
            Ativo
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white/80 p-3 dark:bg-black/20">
            <p className="text-xs font-bold uppercase opacity-70">Token</p>
            <p className="mt-1 font-semibold">{printerAgent.hasToken ? "Token gerado" : "Nenhum token gerado"}</p>
          </div>
          <div className="rounded-2xl bg-white/80 p-3 dark:bg-black/20">
            <p className="text-xs font-bold uppercase opacity-70">Ultima conexao</p>
            <p className="mt-1 font-semibold">
              {printerAgent.lastSeenAt ? new Date(printerAgent.lastSeenAt).toLocaleString("pt-BR") : "Ainda nao conectado"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-2xl bg-emerald-700 px-4 py-3 font-bold text-white"
            onClick={() => void generatePrinterToken()}
          >
            {printerAgent.hasToken ? "Gerar novo token" : "Gerar token"}
          </button>
        </div>

        {newPrinterToken && (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
            <p className="font-bold">Copie este token agora:</p>
            <div className="mt-2 flex flex-col gap-2 md:flex-row">
              <input
                className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 font-mono text-xs"
                readOnly
                value={newPrinterToken}
              />
              <button
                type="button"
                className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white"
                onClick={() => {
                  void navigator.clipboard.writeText(newPrinterToken);
                  toast.success("Token copiado");
                }}
              >
                Copiar
              </button>
            </div>
            <p className="mt-2 text-xs">
              Por seguranca, depois que sair desta tela o token completo nao sera exibido novamente.
            </p>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-3 text-xl font-bold">Impressora termica</h2>
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Para impressao automatica, instale e mantenha o QZ Tray aberto no computador da loja.
          Ele permite ao painel localizar e usar as impressoras instaladas no Windows.
          <a className="ml-1 font-semibold underline" href={printAgentInstallUrl()} target="_blank" rel="noreferrer">
            Baixar QZ Tray
          </a>
        </div>
        <label className="mb-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.printerEnabled}
            onChange={(e) => setForm((value) => ({ ...value, printerEnabled: e.target.checked }))}
          />
          Ativar impressao de pedidos
        </label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-semibold">Impressora cadastrada</span>
            <select
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              value={form.printerName}
              onChange={(e) => setForm((value) => ({ ...value, printerName: e.target.value }))}
            >
              <option value="">Selecione uma impressora</option>
              {form.printerName && !printers.includes(form.printerName) && (
                <option value={form.printerName}>{form.printerName}</option>
              )}
              {printers.map((printer) => <option key={printer} value={printer}>{printer}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold">Largura do papel</span>
            <select
              className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
              value={form.printerPaperWidth}
              onChange={(e) => setForm((value) => ({ ...value, printerPaperWidth: Number(e.target.value) }))}
            >
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </select>
          </label>
          <button
            type="button"
            className="rounded-xl border border-black/15 px-4 py-2 dark:border-white/20"
            onClick={() => void searchPrinters()}
            disabled={agentStatus === "connecting"}
          >
            {agentStatus === "connecting" ? "Procurando..." : "Buscar impressoras deste computador"}
          </button>
          <button
            type="button"
            className="self-end rounded-xl bg-slate-700 px-4 py-2 text-white"
            onClick={() => void testPrinter()}
          >
            Testar impressao
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.printerAutoPrint}
            onChange={(e) => setForm((value) => ({ ...value, printerAutoPrint: e.target.checked }))}
            disabled={!form.printerName}
          />
          Imprimir automaticamente quando chegar pedido
        </label>
        <p className="mt-2 text-xs opacity-70">
          Status do agente: {agentStatus === "connected" ? "conectado" : agentStatus === "error" ? "não encontrado" : "não verificado"}.
          O painel de pedidos precisa permanecer aberto.
        </p>
      </section>

      <button className="mt-4 w-full rounded-xl bg-ember px-4 py-3 text-white" onClick={() => void save()}>
        Salvar Configurações
      </button>
    </main>
  );
}
