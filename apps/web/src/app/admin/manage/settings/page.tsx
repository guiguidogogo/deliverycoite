"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL, apiFetch, readApiJson } from "../../../../lib/api";
import { LocationPicker } from "../../../../components/location-picker";
import { printTestReceipt, testReceiptHtml } from "../../../../lib/browser-print";
import { findLocalPrinters, printHtmlWithAgent } from "../../../../lib/qz-print";

type ClosedOrderPolicy = "BLOCK_WHEN_CLOSED" | "ALLOW_WHEN_CLOSED" | "SCHEDULE_ONLY_WHEN_CLOSED";

type BusinessHourPeriod = {
  openingTime: string;
  closingTime: string;
};

type BusinessHourDay = {
  dayOfWeek: number;
  isOpen: boolean;
  periods: BusinessHourPeriod[];
};

const weekDays = [
  { dayOfWeek: 1, label: "Segunda-feira" },
  { dayOfWeek: 2, label: "Terca-feira" },
  { dayOfWeek: 3, label: "Quarta-feira" },
  { dayOfWeek: 4, label: "Quinta-feira" },
  { dayOfWeek: 5, label: "Sexta-feira" },
  { dayOfWeek: 6, label: "Sabado" },
  { dayOfWeek: 0, label: "Domingo" }
];

function defaultBusinessHours(): BusinessHourDay[] {
  return weekDays.map(({ dayOfWeek }) => ({
    dayOfWeek,
    isOpen: dayOfWeek !== 0,
    periods: dayOfWeek === 0 ? [] : [{ openingTime: "08:00", closingTime: "18:00" }]
  }));
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function validateBusinessHours(days: BusinessHourDay[]) {
  for (const dayInfo of weekDays) {
    const day = days.find((item) => item.dayOfWeek === dayInfo.dayOfWeek);
    if (!day || !day.isOpen) continue;
    if (!day.periods.length) {
      return `${dayInfo.label}: informe ao menos um horario ou marque como fechado.`;
    }
    const periods = [...day.periods].sort((left, right) => timeToMinutes(left.openingTime) - timeToMinutes(right.openingTime));
    for (const [index, period] of periods.entries()) {
      if (!timePattern.test(period.openingTime) || !timePattern.test(period.closingTime)) {
        return `${dayInfo.label}: use horarios validos no formato 24h, como 08:00.`;
      }
      if (timeToMinutes(period.openingTime) >= timeToMinutes(period.closingTime)) {
        return `${dayInfo.label}: abertura deve ser anterior ao fechamento.`;
      }
      const previous = periods[index - 1];
      if (previous && timeToMinutes(period.openingTime) < timeToMinutes(previous.closingTime)) {
        return `${dayInfo.label}: o periodo das ${period.openingTime} as ${period.closingTime} entra em conflito com ${previous.openingTime} as ${previous.closingTime}.`;
      }
    }
  }
  return null;
}

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
    printerAutoPrint: false,
    timezone: "America/Bahia",
    closedOrderPolicy: "BLOCK_WHEN_CLOSED" as ClosedOrderPolicy
  });
  const [businessHours, setBusinessHours] = useState<BusinessHourDay[]>(defaultBusinessHours);
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
      .then((res) => readApiJson<any>(res))
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
          printerAutoPrint: data.printerAutoPrint ?? false,
          timezone: data.timezone ?? "America/Bahia",
          closedOrderPolicy: data.closedOrderPolicy ?? "BLOCK_WHEN_CLOSED"
        });
      });

    void apiFetch(`/admin/business-hours`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((res) => res.ok ? readApiJson<any>(res) : null)
      .then((data) => {
        if (!data?.days) return;
        setBusinessHours(
          weekDays.map(({ dayOfWeek }) => {
            const day = data.days.find((item: BusinessHourDay) => item.dayOfWeek === dayOfWeek);
            return {
              dayOfWeek,
              isOpen: Boolean(day?.isOpen),
              periods: Array.isArray(day?.periods) ? day.periods : []
            };
          })
        );
        setForm((current) => ({
          ...current,
          timezone: data.timezone ?? current.timezone,
          closedOrderPolicy: data.closedOrderPolicy ?? current.closedOrderPolicy
        }));
      });

    void apiFetch(`/admin/printer-agent`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    })
      .then((res) => res.ok ? readApiJson<any>(res) : null)
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

    const businessHoursError = validateBusinessHours(businessHours);
    if (businessHoursError) {
      toast.error(businessHoursError);
      return;
    }

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
      const payload = await readApiJson<any>(res).catch(() => ({}));
      const firstIssue = Array.isArray(payload.issues) ? payload.issues[0] : null;
      const field = Array.isArray(firstIssue?.path) ? firstIssue.path.join(".") : "";
      toast.error(firstIssue?.message ? `${field ? `${field}: ` : ""}${firstIssue.message}` : payload.message ?? "Falha ao salvar configuracoes");
      return;
    }

    const hoursRes = await apiFetch(`/admin/business-hours`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        timezone: form.timezone,
        closedOrderPolicy: form.closedOrderPolicy,
        days: businessHours.map((day) => ({
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen,
          periods: day.isOpen
            ? [...day.periods].sort((left, right) => timeToMinutes(left.openingTime) - timeToMinutes(right.openingTime))
            : []
        }))
      })
    });

    if (!hoursRes.ok) {
      const payload = await readApiJson<any>(hoursRes).catch(() => ({}));
      toast.error(payload.message ?? "Falha ao salvar horarios de funcionamento");
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
      toast.error("HubRegional Printer Agent nao esta instalado ou nao esta aberto");
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

    const payload = await readApiJson<any>(res).catch(() => ({}));
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
    const payload = await readApiJson<any>(res).catch(() => ({}));
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
    const payload = await readApiJson<any>(res).catch(() => ({}));
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

  function updateBusinessDay(dayOfWeek: number, updater: (day: BusinessHourDay) => BusinessHourDay) {
    setBusinessHours((current) =>
      current.map((day) => day.dayOfWeek === dayOfWeek ? updater(day) : day)
    );
  }

  function addBusinessPeriod(dayOfWeek: number) {
    updateBusinessDay(dayOfWeek, (day) => ({
      ...day,
      isOpen: true,
      periods: [...day.periods, { openingTime: "08:00", closingTime: "18:00" }]
    }));
  }

  function removeBusinessPeriod(dayOfWeek: number, periodIndex: number) {
    updateBusinessDay(dayOfWeek, (day) => ({
      ...day,
      periods: day.periods.filter((_, index) => index !== periodIndex)
    }));
  }

  function updateBusinessPeriod(
    dayOfWeek: number,
    periodIndex: number,
    field: keyof BusinessHourPeriod,
    value: string
  ) {
    updateBusinessDay(dayOfWeek, (day) => ({
      ...day,
      periods: day.periods.map((period, index) =>
        index === periodIndex ? { ...period, [field]: value } : period
      )
    }));
  }

  function copyMondayToWeekdays() {
    const monday = businessHours.find((day) => day.dayOfWeek === 1);
    if (!monday) return;
    if (!window.confirm("Aplicar os horarios de segunda-feira para terca a sexta? Os horarios atuais desses dias serao substituidos.")) return;
    setBusinessHours((current) =>
      current.map((day) =>
        day.dayOfWeek >= 2 && day.dayOfWeek <= 5
          ? { ...day, isOpen: monday.isOpen, periods: monday.periods.map((period) => ({ ...period })) }
          : day
      )
    );
  }

  function copyDayToAll(dayOfWeek: number) {
    const source = businessHours.find((day) => day.dayOfWeek === dayOfWeek);
    if (!source) return;
    const label = weekDays.find((day) => day.dayOfWeek === dayOfWeek)?.label ?? "dia selecionado";
    if (!window.confirm(`Copiar os horarios de ${label} para todos os outros dias? Os horarios atuais serao substituidos.`)) return;
    setBusinessHours((current) =>
      current.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? day
          : { ...day, isOpen: source.isOpen, periods: source.periods.map((period) => ({ ...period })) }
      )
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4 pb-28">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-4xl">Configuracoes</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white shadow-sm"
            onClick={() => void save()}
          >
            Salvar
          </button>
          <Link className="rounded-lg bg-ink px-3 py-2 text-sm text-white" href="/admin">
            Voltar
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <h2 className="mb-3 text-xl font-bold">Configurações Gerais</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Nome da empresa" value={form.companyName} onChange={(e) => setForm((v) => ({ ...v, companyName: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="WhatsApp Loja" value={form.whatsappNumber} onChange={(e) => setForm((v) => ({ ...v, whatsappNumber: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="WhatsApp Motoboy" value={form.deliveryPhoneNumber} onChange={(e) => setForm((v) => ({ ...v, deliveryPhoneNumber: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Taxa de entrega" value={form.deliveryFee} onChange={(e) => setForm((v) => ({ ...v, deliveryFee: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Fuso horario" value={form.timezone} onChange={(e) => setForm((v) => ({ ...v, timezone: e.target.value }))} />
          <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" value={form.closedOrderPolicy} onChange={(e) => setForm((v) => ({ ...v, closedOrderPolicy: e.target.value as ClosedOrderPolicy }))}>
            <option value="BLOCK_WHEN_CLOSED">Bloquear pedidos quando fechado</option>
            <option value="ALLOW_WHEN_CLOSED">Aceitar pedidos mesmo fechado</option>
            <option value="SCHEDULE_ONLY_WHEN_CLOSED">Somente agendamento quando fechado</option>
          </select>
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Chave PIX" value={form.pixKey} onChange={(e) => setForm((v) => ({ ...v, pixKey: e.target.value }))} />
          <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="URL QR Code PIX" value={form.pixQrCodeUrl} onChange={(e) => setForm((v) => ({ ...v, pixQrCodeUrl: e.target.value }))} />
          <textarea className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Mensagem automatica" value={form.autoMessage} onChange={(e) => setForm((v) => ({ ...v, autoMessage: e.target.value }))} />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-black/10 bg-white/85 p-4 dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-bold">Horarios de funcionamento</h2>
            <p className="mt-1 text-sm opacity-70">
              Configure dias abertos, fechados e varios periodos no mesmo dia. O checkout usa estes horarios para aceitar ou bloquear pedidos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold dark:border-white/20"
              onClick={copyMondayToWeekdays}
            >
              Aplicar segunda a sexta
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {weekDays.map((dayInfo) => {
            const day = businessHours.find((item) => item.dayOfWeek === dayInfo.dayOfWeek) ?? {
              dayOfWeek: dayInfo.dayOfWeek,
              isOpen: false,
              periods: []
            };
            return (
              <article key={dayInfo.dayOfWeek} className="rounded-2xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-slate-950/60">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-black">{dayInfo.label}</h3>
                    <p className="text-xs opacity-65">{day.isOpen ? `${day.periods.length} periodo(s)` : "Fechado"}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold dark:bg-white/10">
                      <input
                        type="checkbox"
                        checked={day.isOpen}
                        onChange={(event) =>
                          updateBusinessDay(dayInfo.dayOfWeek, (current) => ({
                            ...current,
                            isOpen: event.target.checked,
                            periods: event.target.checked && !current.periods.length
                              ? [{ openingTime: "08:00", closingTime: "18:00" }]
                              : current.periods
                          }))
                        }
                      />
                      Aberto
                    </label>
                    <button
                      type="button"
                      className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/20"
                      onClick={() => copyDayToAll(dayInfo.dayOfWeek)}
                    >
                      Copiar para todos
                    </button>
                  </div>
                </div>

                {day.isOpen && (
                  <div className="mt-3 space-y-2">
                    {day.periods.map((period, index) => (
                      <div key={`${dayInfo.dayOfWeek}-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                          type="time"
                          step="60"
                          value={period.openingTime}
                          onChange={(event) => updateBusinessPeriod(dayInfo.dayOfWeek, index, "openingTime", event.target.value)}
                        />
                        <input
                          className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                          type="time"
                          step="60"
                          value={period.closingTime}
                          onChange={(event) => updateBusinessPeriod(dayInfo.dayOfWeek, index, "closingTime", event.target.value)}
                        />
                        <button
                          type="button"
                          className="rounded-xl border border-red-200 px-3 py-2 text-sm font-semibold text-red-700"
                          onClick={() => removeBusinessPeriod(dayInfo.dayOfWeek, index)}
                        >
                          Excluir
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white"
                      onClick={() => addBusinessPeriod(dayInfo.dayOfWeek)}
                    >
                      + Adicionar horario
                    </button>
                  </div>
                )}
              </article>
            );
          })}
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
          Para impressao automatica, use somente o HubRegional Printer Agent instalado no computador da loja.
          Ele recebe os pedidos do sistema e imprime na impressora configurada.
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
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-black/10 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
        <div className="mx-auto flex max-w-3xl gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-base font-black text-white"
            onClick={() => void save()}
          >
            Salvar configurações
          </button>
          <Link className="rounded-xl bg-ink px-4 py-3 text-center font-bold text-white" href="/admin">
            Voltar
          </Link>
        </div>
      </div>
    </main>
  );
}
