"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL } from "../../../../lib/api";
import { LocationPicker } from "../../../../components/location-picker";
import { printTestReceipt } from "../../../../lib/browser-print";

export default function SettingsManagePage() {
  const [form, setForm] = useState({
    companyName: "",
    whatsappNumber: "",
    deliveryPhoneNumber: "",
    deliveryFee: "5",
    storeLatitude: null as number | null,
    storeLongitude: null as number | null,
    deliveryFeeTiers: [] as Array<{ maxDistanceKm: string; fee: string }>,
    openTime: "18:00",
    closeTime: "23:59",
    autoMessage: "",
    pixKey: "",
    pixQrCodeUrl: "",
    menuiaApiKey: "",
    menuiaStoreId: "",
    menuiaEnabled: false,
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
  useEffect(() => {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    void fetch(`${API_URL}/admin/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((res) => res.json())
      .then((data) => {
        setForm({
          companyName: data.companyName ?? "",
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
          pixKey: data.pixKey ?? "",
          pixQrCodeUrl: data.pixQrCodeUrl ?? "",
          menuiaApiKey: data.menuiaApiKey ?? "",
          menuiaStoreId: data.menuiaStoreId ?? "",
          menuiaEnabled: data.menuiaEnabled ?? false,
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

  }, []);

  async function save() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...form,
        printerName: "",
        printerAutoPrint: false,
        deliveryFee: Number(form.deliveryFee),
        deliveryFeeTiers: form.deliveryFeeTiers.map((tier) => ({
          maxDistanceKm: Number(tier.maxDistanceKm),
          fee: Number(tier.fee)
        }))
      })
    });

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      toast.error(payload.message ?? "Falha ao salvar configuracoes");
      return;
    }

    toast.success("Configuracoes salvas");
  }

  async function testMenuia() {
    const token = localStorage.getItem("delivery:token");
    if (!token) return;

    const res = await fetch(`${API_URL}/admin/integrations/menuia/test`, {
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
      toast.error("Geolocalizacao nao suportada");
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
      () => toast.error("Nao foi possivel obter a localizacao")
    );
  }

  function addDeliveryTier() {
    setForm((value) => ({
      ...value,
      deliveryFeeTiers: [...value.deliveryFeeTiers, { maxDistanceKm: "", fee: "" }]
    }));
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
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Horario abertura" value={form.openTime} onChange={(e) => setForm((v) => ({ ...v, openTime: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Horario fechamento" value={form.closeTime} onChange={(e) => setForm((v) => ({ ...v, closeTime: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Chave PIX" value={form.pixKey} onChange={(e) => setForm((v) => ({ ...v, pixKey: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="URL QR Code PIX" value={form.pixQrCodeUrl} onChange={(e) => setForm((v) => ({ ...v, pixQrCodeUrl: e.target.value }))} />
          <textarea className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Mensagem automatica" value={form.autoMessage} onChange={(e) => setForm((v) => ({ ...v, autoMessage: e.target.value }))} />
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
        <p className="mb-3 text-sm opacity-70">Desative as etapas que nao devem consumir envios do WhatsApp.</p>
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

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-3 text-xl font-bold">Impressora termica</h2>
        <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          A impressora fica conectada ao seu computador, nao ao servidor Render.
          Ao clicar em imprimir no pedido, o navegador abrira a lista de impressoras instaladas no Windows.
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
            className="self-end rounded-xl bg-slate-700 px-4 py-2 text-white"
            onClick={() => {
              try {
                printTestReceipt(form.companyName, form.printerPaperWidth === 80 ? 80 : 58);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Falha ao abrir teste");
              }
            }}
          >
            Testar impressao
          </button>
        </div>
        <p className="mt-3 text-xs opacity-70">
          A impressao automatica sem abrir a janela do navegador exige um agente local, que ainda nao esta instalado.
        </p>
      </section>

      <button className="mt-4 w-full rounded-xl bg-ember px-4 py-3 text-white" onClick={() => void save()}>
        Salvar Configurações
      </button>
    </main>
  );
}
