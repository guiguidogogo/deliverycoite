"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../../../lib/api";
import { printHtmlWithAgent } from "../../../../lib/qz-print";

type TableStatus = "FREE" | "OCCUPIED" | "WAITING_PAYMENT" | "RESERVED" | "CLEANING";

type DiningArea = {
  id: string;
  name: string;
};

type RestaurantTable = {
  id: string;
  number: number;
  name?: string | null;
  seats: number;
  status: TableStatus;
  active: boolean;
  qrCodeUrl: string;
  activeSession?: {
    id: string;
    token: string;
    shortCode: string;
    status: "PENDING_CONFIRMATION" | "OPEN" | "CLOSING_REQUESTED" | "CLOSED" | "CANCELLED";
    sessionUrl: string;
    openedAt: string;
    total: number | string;
    customerName?: string | null;
    customerPhone?: string | null;
    customerEmail?: string | null;
    waiterCalledAt?: string | null;
    billRequestedAt?: string | null;
    orderCount?: number;
    itemCount?: number;
    accountTotal?: number | string;
    openedByUser?: { name: string } | null;
  } | null;
  area?: DiningArea | null;
  _count?: { orders: number };
  orderCount?: number;
  itemCount?: number;
  accountTotal?: number | string;
};

type TableOrder = {
  id: string;
  orderNumber: number;
  status: "RECEIVED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FINISHED" | "CANCELED";
  total: number | string;
  subtotal: number | string;
  discount: number | string;
  createdAt: string;
  customer: { name: string; phone: string };
  waiter?: { name: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    price: number | string;
    total: number | string;
    product: { name: string };
    complements: Array<{ id: string; name: string; quantity: number; total: number | string }>;
  }>;
};

type ClosedTableSession = {
  id: string;
  shortCode: string;
  customerName?: string | null;
  customerPhone?: string | null;
  openedAt: string;
  closedAt?: string | null;
  total: number | string;
  orderCount: number;
  itemCount: number;
  openedByUser?: { name: string } | null;
  closedByUser?: { name: string } | null;
};

type PdvAuditLog = {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  userName?: string | null;
  userId?: string | null;
  oldValue?: Record<string, any> | null;
  newValue?: Record<string, any> | null;
  ipAddress?: string | null;
  createdAt: string;
};

type Product = {
  id: string;
  name: string;
  price: number | string;
  promoPrice?: number | string | null;
  available: boolean;
  active: boolean;
  complements?: Array<{
    id: string;
    complementId: string;
    required: boolean;
    complement: {
      id: string;
      name: string;
      description?: string | null;
      price: number | string;
      active: boolean;
    };
  }>;
};

type DraftItem = {
  id: string;
  productId: string;
  quantity: number;
  complements: Array<{ complementId: string; quantity: number }>;
};

type ClosePaymentMethod = "CASH" | "PIX" | "DEBIT" | "CREDIT" | "CARD";
type BillSplitMode = "ITEMS" | "VALUE";
type ServiceFeeType = "PERCENT" | "FIXED";
type PdvAlert = {
  id: string;
  message: string;
  tone: "bill" | "order";
  kind?: "WAITER" | "BILL" | "ORDER";
  tableId?: string;
  sessionId?: string;
};

type PdvPrintSettings = {
  companyName: string;
  printerEnabled: boolean;
  printerName: string;
  paperWidth: 58 | 80;
};

type TableReceiptTotals = {
  subtotal: number;
  serviceFee: number;
  discount: number;
  total: number;
};

function qrImage(url: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
}

const statusLabels: Record<TableStatus, string> = {
  FREE: "Livre",
  OCCUPIED: "Ocupada",
  WAITING_PAYMENT: "Aguardando pagamento",
  RESERVED: "Reservada",
  CLEANING: "Em limpeza"
};

const statusStyles: Record<TableStatus, string> = {
  FREE: "border-emerald-300 bg-emerald-100 text-emerald-900",
  OCCUPIED: "border-orange-300 bg-orange-100 text-orange-900",
  WAITING_PAYMENT: "border-red-300 bg-red-100 text-red-900",
  RESERVED: "border-slate-300 bg-slate-100 text-slate-900",
  CLEANING: "border-blue-300 bg-blue-100 text-blue-900"
};

const orderStatusLabels: Record<TableOrder["status"], string> = {
  RECEIVED: "Recebido",
  PREPARING: "Em preparo",
  OUT_FOR_DELIVERY: "Saiu para entrega",
  DELIVERED: "Entregue",
  FINISHED: "Finalizado",
  CANCELED: "Cancelado"
};

function brl(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function paymentLabel(method: ClosePaymentMethod) {
  const labels: Record<ClosePaymentMethod, string> = {
    CASH: "Dinheiro",
    PIX: "Pix",
    DEBIT: "Cartao debito",
    CREDIT: "Cartao credito",
    CARD: "Cartao"
  };
  return labels[method];
}

function tableReceiptHtml(params: {
  type: "PRE_BILL" | "RECEIPT";
  table: RestaurantTable;
  orders: TableOrder[];
  totals: TableReceiptTotals;
  companyName: string;
  payments?: Array<{ method: ClosePaymentMethod; amount: number }>;
  billSplit?: Array<{ name: string; subtotal: number; serviceFee: number; discount: number; total: number; items: string[] }>;
  paymentDetail?: string;
  notes?: string;
}) {
  const title = params.type === "PRE_BILL" ? "PRE-CONTA" : "RECIBO DE PAGAMENTO";
  const items = params.orders.map((order) => `
    <div class="line"></div>
    <p><strong>Pedido #${String(order.orderNumber).padStart(5, "0")}</strong> <span class="right">${brl(order.total)}</span></p>
    <p class="muted">${escapeHtml(formatDate(order.createdAt))}${order.waiter?.name ? ` - Garcom: ${escapeHtml(order.waiter.name)}` : ""}</p>
    ${order.items.map((item) => `
      <div class="item">
        <div class="row"><strong>${item.quantity}x ${escapeHtml(item.product.name)}</strong><span>${brl(item.total)}</span></div>
        ${item.complements.map((complement) => `
          <div class="complement">+ ${complement.quantity}x ${escapeHtml(complement.name)} ${Number(complement.total) > 0 ? brl(complement.total) : ""}</div>
        `).join("")}
      </div>
    `).join("")}
  `).join("");
  const payments = params.payments?.length
    ? params.payments.map((payment) => `<div class="row"><span>${escapeHtml(paymentLabel(payment.method))}</span><span>${brl(payment.amount)}</span></div>`).join("")
    : params.paymentDetail ? `<p><strong>Pagamento:</strong> ${escapeHtml(params.paymentDetail)}</p>` : "";
  const billSplit = params.billSplit?.length
    ? params.billSplit.map((person) => `
      <p><strong>${escapeHtml(person.name)}:</strong> <span class="right">${brl(person.total)}</span></p>
      <p class="muted">Subtotal ${brl(person.subtotal)} | Taxa ${brl(person.serviceFee)} | Desc ${brl(person.discount)}</p>
      ${(person.items ?? []).map((item) => `<div class="complement">- ${escapeHtml(item)}</div>`).join("")}
    `).join("")
    : "";

  return `
    <h1>${escapeHtml(params.companyName || "HubRegional")}</h1>
    <h2>${title}</h2>
    <p class="center">Mesa ${params.table.number}${params.table.area?.name ? ` - ${escapeHtml(params.table.area.name)}` : ""}</p>
    <p class="center muted">${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>
    ${params.type === "PRE_BILL" ? `<p class="center warn">NAO E COMPROVANTE DE PAGAMENTO</p>` : `<p class="center paid">PAGAMENTO REGISTRADO</p>`}
    ${params.table.activeSession?.customerName ? `<p><strong>Cliente:</strong> ${escapeHtml(params.table.activeSession.customerName)}</p>` : ""}
    ${params.table.activeSession?.customerPhone ? `<p><strong>Telefone:</strong> ${escapeHtml(params.table.activeSession.customerPhone)}</p>` : ""}
    ${items}
    <div class="line"></div>
    <div class="row"><span>Subtotal</span><span>${brl(params.totals.subtotal)}</span></div>
    <div class="row"><span>Taxa de servico</span><span>${brl(params.totals.serviceFee)}</span></div>
    <div class="row"><span>Desconto</span><span>${brl(params.totals.discount)}</span></div>
    <div class="row total"><span>Total</span><span>${brl(params.totals.total)}</span></div>
    ${payments ? `<div class="line"></div>${payments}` : ""}
    ${billSplit ? `<div class="line"></div><p><strong>DIVISAO DA CONTA</strong></p>${billSplit}` : ""}
    ${params.notes ? `<div class="line"></div><p><strong>Obs:</strong> ${escapeHtml(params.notes)}</p>` : ""}
    <br /><br />
  `;
}

function printWindowHtml(content: string, paperWidth: 58 | 80) {
  const popup = window.open("", "_blank", "width=480,height=720");
  if (!popup) throw new Error("O navegador bloqueou a janela de impressao. Permita pop-ups para este site.");
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Impressao PDV</title>
  <style>
    @page { size: ${paperWidth}mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { width: ${paperWidth - 6}mm; margin: 0; color: #000; background: #fff; font: 12px/1.35 "Courier New", monospace; }
    h1, h2, p { margin: 0 0 5px; }
    h1 { font-size: 16px; text-align: center; }
    h2 { font-size: 14px; text-align: center; }
    .center { text-align: center; }
    .muted { color: #555; font-size: 11px; }
    .warn { border: 1px solid #000; padding: 3px; font-weight: 700; }
    .paid { font-weight: 700; }
    .line { border-top: 1px dashed #000; margin: 7px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .right { float: right; }
    .item { margin: 5px 0; }
    .complement { padding-left: 8px; font-size: 11px; }
    .total { font-size: 15px; font-weight: 700; }
    .no-print { margin: 14px 0; text-align: center; }
    button { padding: 8px 14px; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>${content}
  <div class="no-print"><button onclick="window.print()">Escolher impressora</button></div>
  <script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 250); });</script>
</body>
</html>`);
  popup.document.close();
}

export default function PdvPage() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const [closedSessions, setClosedSessions] = useState<ClosedTableSession[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [draftProductId, setDraftProductId] = useState("");
  const [draftProductSearch, setDraftProductSearch] = useState("");
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null);
  const [configuringQuantity, setConfiguringQuantity] = useState(1);
  const [configuringComplements, setConfiguringComplements] = useState<Record<string, number>>({});
  const [draftCustomerName, setDraftCustomerName] = useState("Cliente da mesa");
  const [draftNotes, setDraftNotes] = useState("");
  const [closePaymentMethod, setClosePaymentMethod] = useState<ClosePaymentMethod>("PIX");
  const [closeNotes, setCloseNotes] = useState("");
  const [closeDiscount, setCloseDiscount] = useState(0);
  const [closeDiscountReason, setCloseDiscountReason] = useState("");
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(false);
  const [serviceFeeType, setServiceFeeType] = useState<ServiceFeeType>("PERCENT");
  const [serviceFeePercent, setServiceFeePercent] = useState(10);
  const [serviceFeeAmount, setServiceFeeAmount] = useState(0);
  const [splitPayments, setSplitPayments] = useState<Array<{ method: ClosePaymentMethod; amount: number }>>([]);
  const [billPeople, setBillPeople] = useState(["Pessoa 1", "Pessoa 2"]);
  const [itemSplitAssignments, setItemSplitAssignments] = useState<Record<string, number>>({});
  const [billSplitMode, setBillSplitMode] = useState<BillSplitMode>("VALUE");
  const [valueSplitAmounts, setValueSplitAmounts] = useState<number[]>([]);
  const [valueSplitMethods, setValueSplitMethods] = useState<ClosePaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [closingTable, setClosingTable] = useState(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [areaFilter, setAreaFilter] = useState("all");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alerts, setAlerts] = useState<PdvAlert[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [targetTableId, setTargetTableId] = useState("");
  const [movingTable, setMovingTable] = useState(false);
  const [showQrPanel, setShowQrPanel] = useState(false);
  const [showClosePanel, setShowClosePanel] = useState(false);
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [showPaymentSplitPanel, setShowPaymentSplitPanel] = useState(false);
  const [showBillSplitPanel, setShowBillSplitPanel] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showAuditPanel, setShowAuditPanel] = useState(false);
  const [auditLogs, setAuditLogs] = useState<PdvAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditOnlySelectedTable, setAuditOnlySelectedTable] = useState(true);
  const [printSettings, setPrintSettings] = useState<PdvPrintSettings>({
    companyName: "HubRegional",
    printerEnabled: false,
    printerName: "",
    paperWidth: 58
  });
  const previousTablesRef = useRef<Map<string, { status: TableStatus; orders: number; waiterCalledAt: string | null }>>(new Map());
  const soundEnabledRef = useRef(false);

  const areas = useMemo(() => {
    const byId = new Map<string, DiningArea>();
    tables.forEach((table) => {
      if (table.area) byId.set(table.area.id, table.area);
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tables]);

  const filteredTables = useMemo(
    () => tables.filter((table) => table.active && (areaFilter === "all" || table.area?.id === areaFilter)),
    [areaFilter, tables]
  );

  const totals = useMemo(() => {
  const openOrders = orders.filter((order) => order.status !== "CANCELED");
    return {
      count: openOrders.length,
      total: openOrders.reduce((sum, order) => sum + Number(order.total), 0),
      items: openOrders.reduce((sum, order) => sum + order.items.reduce((acc, item) => acc + item.quantity, 0), 0)
    };
  }, [orders]);

  const draftTotal = useMemo(() => draftItems.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    if (!product) return sum;
    const complements = item.complements.reduce((acc, selected) => {
      const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
      return acc + Number(link?.complement.price ?? 0) * selected.quantity;
    }, 0);
    return sum + (Number(product.promoPrice ?? product.price) + complements) * item.quantity;
  }, 0), [draftItems, products]);

  const accountTotals = useMemo(() => {
    const serviceFee = serviceFeeEnabled
      ? serviceFeeType === "FIXED"
        ? Math.max(0, serviceFeeAmount || 0)
        : totals.total * ((serviceFeePercent || 0) / 100)
      : 0;
    const discount = Math.min(Math.max(closeDiscount || 0, 0), totals.total + serviceFee);
    return {
      subtotal: totals.total,
      serviceFee,
      discount,
      total: Math.max(0, totals.total + serviceFee - discount)
    };
  }, [closeDiscount, serviceFeeAmount, serviceFeeEnabled, serviceFeePercent, serviceFeeType, totals.total]);
  const splitPaidTotal = useMemo(
    () => splitPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [splitPayments]
  );
  const splitRemaining = Math.max(0, accountTotals.total - splitPaidTotal);
  const splitDifference = splitPayments.length ? splitPaidTotal - accountTotals.total : 0;
  const splitIsBalanced = !splitPayments.length || Math.abs(splitDifference) <= 0.02;
  const billSplit = useMemo(() => {
    const people = billPeople.length ? billPeople : ["Pessoa 1"];
    const rows = people.map((name, index) => ({
      name: name.trim() || `Pessoa ${index + 1}`,
      subtotal: 0,
      serviceFee: 0,
      discount: 0,
      total: 0,
      items: [] as string[]
    }));
    if (billSplitMode === "VALUE") {
      return rows.map((row, index) => ({
        ...row,
        subtotal: Number(valueSplitAmounts[index] ?? 0),
        total: Number(valueSplitAmounts[index] ?? 0),
        items: ["Divisao manual por valor"]
      }));
    }
    const activeOrders = orders.filter((order) => order.status !== "CANCELED");
    activeOrders.forEach((order) => {
      order.items.forEach((item) => {
        const assigned = itemSplitAssignments[item.id] ?? 0;
        const index = Math.min(rows.length - 1, Math.max(0, assigned));
        const value = Number(item.total ?? 0);
        rows[index].subtotal += value;
        rows[index].items.push(`#${String(order.orderNumber).padStart(5, "0")} - ${item.quantity}x ${item.product.name}`);
      });
    });
    const subtotal = rows.reduce((sum, row) => sum + row.subtotal, 0);
    return rows.map((row) => {
      const ratio = subtotal > 0 ? row.subtotal / subtotal : 0;
      const serviceFee = accountTotals.serviceFee * ratio;
      const discount = accountTotals.discount * ratio;
      return {
        ...row,
        serviceFee,
        discount,
        total: Math.max(0, row.subtotal + serviceFee - discount)
      };
    });
  }, [accountTotals.discount, accountTotals.serviceFee, billPeople, billSplitMode, itemSplitAssignments, orders, valueSplitAmounts]);
  const billSplitValueTotal = useMemo(
    () => valueSplitAmounts.reduce((sum, amount) => sum + Number(amount || 0), 0),
    [valueSplitAmounts]
  );
  const billSplitValueDifference = billSplitValueTotal - accountTotals.total;
  const billSplitValueBalanced = billSplitMode !== "VALUE" || Math.abs(billSplitValueDifference) <= 0.02;
  const tableCanReceiveOrders = selectedTable?.activeSession?.status === "OPEN";
  const filteredProductsForDraft = useMemo(() => {
    const term = draftProductSearch.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      product.name.toLowerCase().includes(term)
      || product.complements?.some((link) => link.complement.name.toLowerCase().includes(term))
    );
  }, [draftProductSearch, products]);

  const can = (permission: string) => permissions.includes("*") || permissions.includes(permission);
  const canOpenPdv = can("PDV_OPEN") || can("ORDERS");
  const canManagePdv = can("PDV_MANAGE") || can("CASH_MANAGE");
  const canClosePdv = can("PDV_CLOSE") || can("CASH_MANAGE");
  const canHistoryPdv = can("PDV_HISTORY") || can("CASH_MANAGE") || can("FINANCE");
  const canAuditPdv = canHistoryPdv || can("AUDIT_VIEW");

  useEffect(() => {
    if (billSplitMode !== "VALUE") return;
    if (valueSplitAmounts.length !== billPeople.length) {
      setValueSplitAmounts(distributeAccountByPeople(billPeople.length));
    }
    if (valueSplitMethods.length !== billPeople.length) {
      setValueSplitMethods(billPeople.map((_, index) => valueSplitMethods[index] ?? closePaymentMethod));
    }
  }, [billPeople, billSplitMode, closePaymentMethod, valueSplitAmounts.length, valueSplitMethods, accountTotals.total]);

  const configuringTotal = useMemo(() => {
    if (!configuringProduct) return 0;
    const complements = (configuringProduct.complements ?? []).reduce((sum, link) =>
      sum + Number(link.complement.price) * (configuringComplements[link.complementId] ?? 0), 0);
    return (Number(configuringProduct.promoPrice ?? configuringProduct.price) + complements) * configuringQuantity;
  }, [configuringComplements, configuringProduct, configuringQuantity]);

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

  function playAlertSound() {
    if (!soundEnabledRef.current || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.5);
    } catch {
      // Som e apenas uma conveniencia visual/operacional.
    }
  }

  function pushAlert(message: string, tone: PdvAlert["tone"], meta?: Omit<PdvAlert, "id" | "message" | "tone">) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setAlerts((current) => [{ id, message, tone, ...meta }, ...current].slice(0, 5));
    toast(tone === "bill" ? "Conta solicitada" : "Nova movimentacao", { description: message });
    playAlertSound();
  }

  function auditActionLabel(action: string) {
    const labels: Record<string, string> = {
      TABLE_SESSION_OPENED: "Atendimento aberto",
      TABLE_SESSION_APPROVED: "Abertura confirmada",
      TABLE_SESSION_REOPENED: "Conta reaberta",
      TABLE_ORDER_CREATED: "Pedido adicionado",
      TABLE_ACCOUNT_CLOSED: "Conta fechada",
      TABLE_TRANSFERRED: "Comanda transferida",
      TABLES_MERGED: "Mesas juntadas",
      TABLE_DEACTIVATED: "Mesa desativada",
      ORDER_CANCELED: "Pedido cancelado",
      ORDER_STATUS_CHANGED: "Status do pedido alterado"
    };
    return labels[action] ?? action;
  }

  function auditDescription(log: PdvAuditLog) {
    const data = log.newValue ?? {};
    const old = log.oldValue ?? {};
    if (log.action === "TABLE_ORDER_CREATED") {
      return `Mesa ${data.tableNumber ?? "-"} recebeu pedido #${String(data.orderNumber ?? "").padStart(5, "0")} no valor de ${brl(data.total ?? 0)}.`;
    }
    if (log.action === "TABLE_ACCOUNT_CLOSED") {
      return `Mesa ${old.tableNumber ?? data.tableNumber ?? "-"} fechada por ${brl(data.total ?? 0)} via ${data.paymentDetail ?? "pagamento registrado"}.`;
    }
    if (log.action === "ORDER_CANCELED") {
      return `Pedido cancelado. Motivo: ${data.reason ?? "-"}. Estoque ${data.stockRestored ? "reposto" : "nao reposto"}.`;
    }
    if (log.action === "TABLE_TRANSFERRED" || log.action === "TABLES_MERGED") {
      return `Mesa ${old.sourceTableNumber ?? "-"} -> Mesa ${data.targetTableNumber ?? "-"} | ${data.orders?.length ?? 0} pedido(s) | ${brl(data.total ?? 0)}.`;
    }
    if (log.action === "TABLE_SESSION_REOPENED") {
      return `Mesa ${data.tableNumber ?? "-"} reaberta para novos pedidos.`;
    }
    return `Registro ${log.entity}${log.entityId ? ` #${log.entityId.slice(0, 8)}` : ""}.`;
  }

  function detectTableChanges(nextTables: RestaurantTable[]) {
    const previous = previousTablesRef.current;
    if (!previous.size) {
      previousTablesRef.current = new Map(nextTables.map((table) => [table.id, {
        status: table.status,
        orders: table.orderCount ?? table._count?.orders ?? 0,
        waiterCalledAt: table.activeSession?.waiterCalledAt ?? null
      }]));
      return;
    }

    nextTables.forEach((table) => {
      const old = previous.get(table.id);
      const orderCount = table.orderCount ?? table._count?.orders ?? 0;
      const waiterCalledAt = table.activeSession?.waiterCalledAt ?? null;
      if (!old) return;
      if (waiterCalledAt && waiterCalledAt !== old.waiterCalledAt) {
        pushAlert(`Mesa ${table.number} chamou o garÃ§om`, "order", {
          kind: "WAITER",
          tableId: table.id,
          sessionId: table.activeSession?.id
        });
      } else if (old.status !== "WAITING_PAYMENT" && table.status === "WAITING_PAYMENT") {
        pushAlert(`Mesa ${table.number} solicitou a conta`, "bill", { kind: "BILL", tableId: table.id, sessionId: table.activeSession?.id });
      } else if (orderCount > old.orders) {
        pushAlert(`Mesa ${table.number} recebeu novo pedido`, "order", { kind: "ORDER", tableId: table.id, sessionId: table.activeSession?.id });
      } else if (old.status === "FREE" && table.status === "OCCUPIED" && orderCount === old.orders) {
        pushAlert(`Mesa ${table.number} mudou para ocupada`, "order", { kind: "ORDER", tableId: table.id, sessionId: table.activeSession?.id });
      }
    });
    previousTablesRef.current = new Map(nextTables.map((table) => [table.id, {
      status: table.status,
      orders: table.orderCount ?? table._count?.orders ?? 0,
      waiterCalledAt: table.activeSession?.waiterCalledAt ?? null
    }]));
  }

  async function loadTables() {
    setLoading(true);
    try {
      const loaded = await request("/admin/tables");
      const nextTables = loaded ?? [];
      detectTableChanges(nextTables);
      setTables(nextTables);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar PDV");
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    try {
      const loaded = await request("/admin/products");
      setProducts((loaded ?? []).filter((product: Product) => product.active !== false && product.available !== false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar produtos");
    }
  }

  async function loadPdvAudit(tableOverride?: RestaurantTable | null) {
    setLoadingAudit(true);
    try {
      const tableForFilter = tableOverride === undefined ? selectedTable : tableOverride;
      const params = new URLSearchParams();
      if (auditOnlySelectedTable && tableForFilter?.id) params.set("tableId", tableForFilter.id);
      const loaded = await request(`/admin/tables/audit${params.toString() ? `?${params.toString()}` : ""}`);
      setAuditLogs(loaded ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar auditoria do PDV");
    } finally {
      setLoadingAudit(false);
    }
  }

  async function loadOrders(table: RestaurantTable) {
    setSelectedTable(table);
    setDraftItems([]);
    setDraftProductId("");
    setDraftProductSearch("");
    setDraftQuantity(1);
    setDraftNotes("");
    setDraftCustomerName("Cliente da mesa");
    setClosePaymentMethod("PIX");
    setCloseNotes("");
    setCloseDiscount(0);
    setCloseDiscountReason("");
    setServiceFeeType("PERCENT");
    setServiceFeeAmount(0);
    setSplitPayments([]);
    setBillPeople(["Pessoa 1", "Pessoa 2"]);
    setItemSplitAssignments({});
    setBillSplitMode("VALUE");
    setValueSplitAmounts([]);
    setValueSplitMethods([]);
    setClosedSessions([]);
    setTargetTableId("");
    setShowQrPanel(false);
    setShowClosePanel(false);
    setShowMovePanel(false);
    setShowPaymentSplitPanel(false);
    setShowBillSplitPanel(false);
    setShowHistoryPanel(false);
    setAuditLogs([]);
    setLoadingOrders(true);
    try {
      const loaded = await request(`/admin/tables/${table.id}/orders`);
      setOrders(loaded ?? []);
      void loadTableHistory(table);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar pedidos da mesa");
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }

  async function openSession(table: RestaurantTable) {
    if (openingSession) return;
    setOpeningSession(true);
    try {
      const session = await request(`/admin/tables/${table.id}/session`, { method: "POST" });
      const updated = {
        ...table,
        status: "OCCUPIED" as TableStatus,
        activeSession: session,
        qrCodeUrl: session.sessionUrl
      };
      setSelectedTable(updated);
      setTables((current) => current.map((item) => item.id === table.id ? updated : item));
      toast.success("Atendimento aberto com QR Code seguro");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao abrir atendimento");
    } finally {
      setOpeningSession(false);
    }
  }

  async function loadPrintSettings() {
    try {
      const settings = await request("/admin/settings");
      setPrintSettings({
        companyName: settings?.companyName || "HubRegional",
        printerEnabled: Boolean(settings?.printerEnabled),
        printerName: settings?.printerName ?? "",
        paperWidth: settings?.printerPaperWidth === 80 ? 80 : 58
      });
      setServiceFeeEnabled(Boolean(settings?.tableServiceFeeEnabled));
      setServiceFeePercent(Number(settings?.tableServiceFeePercent ?? 10));
    } catch {
      // As configuracoes de impressao nao podem bloquear o uso do PDV.
    }
  }

  async function approveSession(table: RestaurantTable) {
    if (!table.activeSession) return;
    try {
      const session = await request(`/admin/tables/${table.id}/session/${table.activeSession.id}/approve`, { method: "POST" });
      const updated = {
        ...table,
        status: "OCCUPIED" as TableStatus,
        activeSession: session,
        qrCodeUrl: session.sessionUrl
      };
      setSelectedTable(updated);
      setTables((current) => current.map((item) => item.id === table.id ? updated : item));
      toast.success("Mesa liberada para o cliente");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao confirmar abertura da mesa");
    }
  }

  async function acknowledgeAlert(alert: PdvAlert) {
    setAlerts((current) => current.filter((item) => {
      if (alert.kind === "WAITER" && item.kind === "WAITER" && item.tableId === alert.tableId) return false;
      return item.id !== alert.id;
    }));
    if (alert.kind !== "WAITER" || !alert.tableId || !alert.sessionId) return;

    try {
      await request(`/admin/tables/${alert.tableId}/session/${alert.sessionId}/ack-waiter`, { method: "POST" });
      setTables((current) => current.map((table) => table.id === alert.tableId
        ? {
            ...table,
            activeSession: table.activeSession
              ? { ...table.activeSession, waiterCalledAt: null }
              : table.activeSession
          }
        : table
      ));
      setSelectedTable((current) => {
        if (!current || current.id !== alert.tableId) return current;
        return {
          ...current,
          activeSession: current.activeSession
            ? { ...current.activeSession, waiterCalledAt: null }
            : current.activeSession
        };
      });
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel marcar chamado como atendido");
    }
  }

  async function reopenSession(table: RestaurantTable) {
    if (!table.activeSession) return;
    try {
      const session = await request(`/admin/tables/${table.id}/session/${table.activeSession.id}/reopen`, { method: "POST" });
      const updated = {
        ...table,
        status: "OCCUPIED" as TableStatus,
        activeSession: session,
        qrCodeUrl: session.sessionUrl
      };
      setSelectedTable(updated);
      setTables((current) => current.map((item) => item.id === table.id ? updated : item));
      toast.success("Conta reaberta para novos pedidos");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reabrir conta");
    }
  }

  function addDraftItem() {
    if (!tableCanReceiveOrders) {
      toast.error("Abra o atendimento da mesa antes de adicionar produtos.");
      return;
    }
    if (!draftProductId) return;
    const product = products.find((item) => item.id === draftProductId);
    if (!product) return;
    setConfiguringProduct(product);
    setConfiguringQuantity(draftQuantity);
    setConfiguringComplements(Object.fromEntries(
      (product.complements ?? [])
        .filter((link) => link.required && link.complement.active)
        .map((link) => [link.complementId, 1])
    ));
  }

  function confirmConfiguredItem() {
    if (!configuringProduct) return;
    const missing = (configuringProduct.complements ?? []).find((link) =>
      link.required && link.complement.active && (configuringComplements[link.complementId] ?? 0) <= 0
    );
    if (missing) {
      toast.error(`O complemento ${missing.complement.name} e obrigatorio`);
      return;
    }
    const complements = Object.entries(configuringComplements)
      .filter(([, quantity]) => quantity > 0)
      .map(([complementId, quantity]) => ({ complementId, quantity }));
    setDraftItems((current) => [
      ...current,
      {
        id: `${configuringProduct.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        productId: configuringProduct.id,
        quantity: configuringQuantity,
        complements
      }
    ]);
    setConfiguringProduct(null);
    setConfiguringQuantity(1);
    setConfiguringComplements({});
    setDraftProductId("");
    setDraftQuantity(1);
  }

  async function createTableOrder() {
    if (!selectedTable || !draftItems.length || savingOrder) return;
    if (!canOpenPdv) {
      toast.error("Seu perfil nao permite lancar pedidos no PDV.");
      return;
    }
    if (!tableCanReceiveOrders) {
      toast.error("Abra o atendimento da mesa antes de enviar pedidos.");
      return;
    }
    if (selectedTable.activeSession?.status === "CLOSING_REQUESTED") {
      toast.error("A conta foi solicitada. Reabra a conta para fazer novos pedidos.");
      return;
    }
    setSavingOrder(true);
    try {
      await request(`/admin/tables/${selectedTable.id}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerName: draftCustomerName || "Cliente da mesa",
          notes: draftNotes || undefined,
          paymentMethod: "PIX",
          items: draftItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            complements: item.complements
          }))
        })
      });
      toast.success("Pedido enviado para a cozinha");
      setDraftItems([]);
      setDraftNotes("");
      await loadOrders(selectedTable);
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar pedido");
    } finally {
      setSavingOrder(false);
    }
  }

  async function printPdvDocument(content: string, successMessage: string) {
    if (printSettings.printerEnabled && printSettings.printerName) {
      try {
        await printHtmlWithAgent(printSettings.printerName, content, printSettings.paperWidth);
        toast.success(successMessage);
        return;
      } catch {
        toast.warning("Agente de impressao indisponivel. Abrindo impressao manual.");
      }
    }
    printWindowHtml(content, printSettings.paperWidth);
  }

  async function closeTableAccount() {
    if (!selectedTable || closingTable) return;
    if (!canClosePdv) {
      toast.error("Seu perfil nao permite receber e fechar conta.");
      return;
    }
    if (!orders.length) {
      toast.error("Nao ha pedidos para fechar nesta mesa");
      return;
    }
    const valueModePayments = billSplitMode === "VALUE"
      ? billPeople.map((_, index) => ({
          method: valueSplitMethods[index] ?? closePaymentMethod,
          amount: Number(valueSplitAmounts[index] ?? 0)
        })).filter((payment) => payment.amount > 0)
      : [];
    const effectiveSplitPayments = valueModePayments.length ? valueModePayments : splitPayments;
    if (splitPayments.length && !splitIsBalanced) {
      toast.error(`Pagamento dividido nao bate com o total. DiferenÃ§a: ${brl(Math.abs(splitDifference))}`);
      return;
    }
    if (billSplitMode === "VALUE" && !billSplitValueBalanced) {
      toast.error(`Divisao por valor nao bate com o total. Diferenca: ${brl(Math.abs(billSplitValueDifference))}`);
      return;
    }
    const confirmed = window.confirm(`Fechar a mesa ${selectedTable.number} no valor de ${brl(accountTotals.total)}?`);
    if (!confirmed) return;
    setClosingTable(true);
    try {
      const receiptPayments = splitPayments.length
        ? splitPayments
        : valueModePayments.length
          ? valueModePayments
        : [{ method: closePaymentMethod, amount: accountTotals.total }];
      const result = await request(`/admin/tables/${selectedTable.id}/close`, {
        method: "POST",
        body: JSON.stringify({
          paymentMethod: closePaymentMethod,
          discount: closeDiscount,
          discountReason: closeDiscountReason || undefined,
          serviceFeeEnabled,
          serviceFeeType,
          serviceFeePercent,
          serviceFeeAmount,
          payments: effectiveSplitPayments.length ? effectiveSplitPayments : undefined,
          billSplit,
          notes: closeNotes || undefined
        })
      });
      toast.success(`Mesa fechada: ${brl(result.total)} em ${result.paymentDetail}`);
      if (result.printerJob?.id) {
        toast.success("Recibo enviado para a fila do Printer Agent");
      } else {
        const receiptHtml = tableReceiptHtml({
          type: "RECEIPT",
          table: selectedTable,
          orders,
          totals: accountTotals,
          companyName: printSettings.companyName,
          payments: receiptPayments,
          billSplit,
          paymentDetail: result.paymentDetail,
          notes: closeNotes || undefined
        });
        await printPdvDocument(receiptHtml, "Recibo enviado para impressao");
      }
      setOrders([]);
      setSelectedTable((current) => current ? { ...current, status: "FREE", _count: { orders: 0 } } : current);
      await loadTables();
      setSelectedTable(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao fechar mesa");
    } finally {
      setClosingTable(false);
    }
  }

  async function printTableAccount() {
    if (!selectedTable) return;

    let printableOrders = orders;
    try {
      const latest = await request(`/admin/tables/${selectedTable.id}/orders`);
      printableOrders = latest ?? orders;
      setOrders(printableOrders);
    } catch {
      // Se a atualizacao falhar, imprime o que ja esta carregado na tela.
    }

    if (!printableOrders.length) {
      toast.error("Nao ha pedidos para imprimir nesta mesa");
      return;
    }

    const subtotal = printableOrders.reduce((sum, order) => sum + Number(order.total), 0);
    const serviceFee = serviceFeeEnabled ? subtotal * (serviceFeePercent / 100) : 0;
    const discount = Math.min(Math.max(closeDiscount || 0, 0), subtotal + serviceFee);
    const total = Math.max(0, subtotal + serviceFee - discount);
    try {
      const job = await request(`/admin/tables/${selectedTable.id}/print-job`, {
        method: "POST",
        body: JSON.stringify({
          type: "PRE_BILL",
          discount,
          serviceFeeEnabled,
          serviceFeeType,
          serviceFeePercent,
          serviceFeeAmount,
          billSplit,
          notes: closeNotes || undefined
        })
      });
      toast.success(job?.message ?? "Pre-conta enviada para a fila do Printer Agent");
    } catch (error) {
      const content = tableReceiptHtml({
        type: "PRE_BILL",
        table: selectedTable,
        orders: printableOrders,
        totals: { subtotal, serviceFee, discount, total },
        companyName: printSettings.companyName,
        billSplit,
        notes: closeNotes || undefined
      });
      try {
        await printPdvDocument(content, "Pre-conta enviada para impressao manual");
      } catch {
        toast.error(error instanceof Error ? error.message : "Falha ao imprimir pre-conta");
      }
    }
  }

  async function loadMe() {
    try {
      const me = await request("/admin/me");
      setPermissions(me?.permissions ?? []);
    } catch {
      setPermissions([]);
    }
  }

  async function reprintClosedSession(session: ClosedTableSession, type: "PRE_BILL" | "RECEIPT") {
    if (!selectedTable) return;
    try {
      const result = await request(`/admin/tables/${selectedTable.id}/history/${session.id}/reprint`, {
        method: "POST",
        body: JSON.stringify({
          type,
          serviceFeeEnabled,
          serviceFeeType,
          serviceFeePercent,
          serviceFeeAmount,
          discount: closeDiscount,
          notes: `Reimpressao solicitada no PDV em ${new Date().toLocaleString("pt-BR")}`
        })
      });
      toast.success(result?.message ?? "Reimpressao enviada");
      if (result?.receipt && !result?.id) {
        printWindowHtml(`<pre>${escapeHtml(result.receipt)}</pre>`, printSettings.paperWidth);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reimprimir atendimento");
    }
  }

  async function updateStatus(table: RestaurantTable, status: TableStatus) {
    try {
      const updated = await request(`/admin/tables/${table.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      const sessionPatch = status === "WAITING_PAYMENT" && table.activeSession
        ? { activeSession: { ...table.activeSession, status: "CLOSING_REQUESTED" as const, billRequestedAt: new Date().toISOString() } }
        : {};
      setTables((current) => current.map((item) => item.id === table.id ? { ...item, ...updated, ...sessionPatch } : item));
      if (selectedTable?.id === table.id) setSelectedTable((current) => current ? { ...current, ...updated, ...sessionPatch } : current);
      toast.success(`Mesa ${table.number}: ${statusLabels[status]}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar mesa");
    }
  }

  function addSplitPayment(method: ClosePaymentMethod = closePaymentMethod) {
    const amount = Number(splitRemaining > 0 ? splitRemaining.toFixed(2) : accountTotals.total.toFixed(2));
    setSplitPayments((current) => [...current, { method, amount }]);
  }

  function updateSplitPayment(index: number, patch: Partial<{ method: ClosePaymentMethod; amount: number }>) {
    setSplitPayments((current) => current.map((payment, currentIndex) =>
      currentIndex === index ? { ...payment, ...patch } : payment
    ));
  }

  function removeSplitPayment(index: number) {
    setSplitPayments((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function loadTableHistory(table: RestaurantTable) {
    setLoadingHistory(true);
    try {
      const loaded = await request(`/admin/tables/${table.id}/history`);
      setClosedSessions(loaded ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar historico da mesa");
      setClosedSessions([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  function addBillPerson() {
    setBillPeople((current) => {
      const next = [...current, `Pessoa ${current.length + 1}`];
      setValueSplitAmounts(distributeAccountByPeople(next.length));
      setValueSplitMethods((methods) => [...methods, closePaymentMethod]);
      return next;
    });
  }

  function updateBillPerson(index: number, name: string) {
    setBillPeople((current) => current.map((person, currentIndex) => currentIndex === index ? name : person));
  }

  function removeBillPerson(index: number) {
    if (billPeople.length <= 1) {
      toast.error("A divisao precisa ter pelo menos uma pessoa");
      return;
    }
    setBillPeople((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      setValueSplitAmounts(distributeAccountByPeople(next.length));
      setValueSplitMethods((methods) => methods.filter((_, currentIndex) => currentIndex !== index));
      return next;
    });
    setItemSplitAssignments((current) => {
      const next: Record<string, number> = {};
      Object.entries(current).forEach(([itemId, personIndex]) => {
        if (personIndex === index) {
          next[itemId] = 0;
        } else if (personIndex > index) {
          next[itemId] = personIndex - 1;
        } else {
          next[itemId] = personIndex;
        }
      });
      return next;
    });
  }

  function distributeAccountByPeople(count = billPeople.length) {
    const peopleCount = Math.max(1, count);
    const cents = Math.round(accountTotals.total * 100);
    const base = Math.floor(cents / peopleCount);
    const remainder = cents - base * peopleCount;
    return Array.from({ length: peopleCount }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
  }

  function switchBillSplitMode(mode: BillSplitMode) {
    setBillSplitMode(mode);
    if (mode === "VALUE") {
      setValueSplitAmounts(distributeAccountByPeople());
      setValueSplitMethods(billPeople.map((_, index) => valueSplitMethods[index] ?? closePaymentMethod));
    }
  }

  function updateValueSplitAmount(index: number, amount: number) {
    const safeAmount = Math.max(0, Number(amount || 0));
    setValueSplitAmounts((current) => {
      const peopleCount = Math.max(1, billPeople.length);
      const next = Array.from({ length: peopleCount }, (_, personIndex) => Number(current[personIndex] ?? 0));
      next[index] = safeAmount;
      const remainingPeople = peopleCount - index - 1;
      if (remainingPeople > 0) {
        const usedCents = Math.round(next.slice(0, index + 1).reduce((sum, value) => sum + value, 0) * 100);
        const totalCents = Math.round(accountTotals.total * 100);
        const remainingCents = Math.max(0, totalCents - usedCents);
        const base = Math.floor(remainingCents / remainingPeople);
        const remainder = remainingCents - base * remainingPeople;
        for (let personIndex = index + 1; personIndex < peopleCount; personIndex += 1) {
          next[personIndex] = (base + (personIndex - index - 1 < remainder ? 1 : 0)) / 100;
        }
      }
      return next;
    });
  }

  function updateValueSplitMethod(index: number, method: ClosePaymentMethod) {
    setValueSplitMethods((current) => {
      const next = Array.from({ length: billPeople.length }, (_, personIndex) => current[personIndex] ?? closePaymentMethod);
      next[index] = method;
      return next;
    });
  }

  async function copyBillSplit() {
    const text = [
      selectedTable ? `Divisao da mesa ${selectedTable.number}` : "Divisao da conta",
      `Total: ${brl(accountTotals.total)}`,
      "",
      ...billSplit.map((person) => [
        `${person.name}: ${brl(person.total)}`,
        person.items.length ? person.items.map((item) => `- ${item}`).join("\n") : "- sem itens"
      ].join("\n"))
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Divisao copiada");
    } catch {
      toast.error("Nao foi possivel copiar a divisao");
    }
  }

  function tableMenuWhatsappUrl(table: RestaurantTable, phoneOverride?: string) {
    const session = table.activeSession;
    const menuUrl = session?.sessionUrl || table.qrCodeUrl || "";
    const code = session?.shortCode ? `\nCodigo de acesso: ${session.shortCode}` : "";
    const message = [
      `Ola! Segue o cardapio digital da mesa ${table.number}:`,
      menuUrl,
      code,
      "",
      "Abra o link, confirme o codigo com o garcom e faca seus pedidos pelo celular."
    ].filter(Boolean).join("\n");
    const rawPhone = (phoneOverride || session?.customerPhone || "").replace(/\D/g, "");
    const phone = rawPhone
      ? rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`
      : "";
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  function sendTableMenuWhatsapp(table: RestaurantTable) {
    const suggested = table.activeSession?.customerPhone ?? "";
    const phone = window.prompt("Informe o WhatsApp do cliente para enviar o cardapio:", suggested)?.trim();
    if (!phone) {
      toast.error("Informe o telefone do cliente");
      return;
    }
    window.open(tableMenuWhatsappUrl(table, phone), "_blank", "noopener,noreferrer");
  }

  async function moveSelectedTable(mode: "TRANSFER" | "MERGE") {
    if (!selectedTable || !targetTableId || movingTable) return;
    if (!canManagePdv) {
      toast.error("Seu perfil nao permite transferir ou juntar mesas.");
      return;
    }
    const target = tables.find((table) => table.id === targetTableId);
    const confirmed = window.confirm(
      mode === "TRANSFER"
        ? `Transferir a comanda da mesa ${selectedTable.number} para a mesa ${target?.number ?? ""}?`
        : `Juntar a comanda da mesa ${selectedTable.number} na mesa ${target?.number ?? ""}?`
    );
    if (!confirmed) return;
    setMovingTable(true);
    try {
      const result = await request(`/admin/tables/${selectedTable.id}/move`, {
        method: "POST",
        body: JSON.stringify({ targetTableId, mode })
      });
      toast.success(
        mode === "TRANSFER"
          ? `Mesa ${result.sourceTableNumber} transferida para mesa ${result.targetTableNumber}`
          : `Mesa ${result.sourceTableNumber} juntada na mesa ${result.targetTableNumber}`
      );
      setSelectedTable(null);
      setOrders([]);
      setTargetTableId("");
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao mover mesa");
    } finally {
      setMovingTable(false);
    }
  }

  async function updateOrderStatus(order: TableOrder, status: TableOrder["status"]) {
    try {
      let reason: string | undefined;
      if (status === "CANCELED" && order.status !== "CANCELED") {
        reason = window.prompt(`Motivo do cancelamento do pedido #${String(order.orderNumber).padStart(5, "0")}:`)?.trim();
        if (!reason) {
          toast.error("Informe o motivo para cancelar");
          return;
        }
      }
      const updated = await request(`/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason })
      });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: updated.status } : item));
      toast.success("Pedido atualizado");
      if (selectedTable) await loadOrders(selectedTable);
      await loadTables();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar pedido");
    }
  }

  useEffect(() => {
    void loadMe();
    void loadTables();
    void loadProducts();
    void loadPrintSettings();
    const timer = window.setInterval(() => void loadTables(), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  return (
    <main className="mx-auto max-w-7xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Atendimento presencial</p>
          <h1 className="font-display text-5xl leading-none">PDV de Mesas</h1>
          <p className="mt-1 text-sm opacity-70">Mapa operacional para acompanhar mesas, pedidos e fechamento.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={`rounded-xl px-3 py-2 font-bold text-white ${soundEnabled ? "bg-emerald-600" : "bg-slate-700"}`}
            onClick={() => {
              const next = !soundEnabledRef.current;
              soundEnabledRef.current = next;
              setSoundEnabled(next);
              if (next) setTimeout(() => playAlertSound(), 50);
            }}
          >
            {soundEnabled ? "Som ativo" : "Ativar som"}
          </button>
          <Link className="rounded-xl border px-3 py-2 font-bold" href="/admin/manage/tables">Cadastrar mesas</Link>
          <Link className="rounded-xl bg-ink px-3 py-2 font-bold text-white" href="/admin">Voltar</Link>
        </div>
      </div>

      {alerts.length > 0 && (
        <section className="mt-4 space-y-2">
          {alerts.map((alert) => (
            <div key={alert.id} className={`flex items-center justify-between gap-3 rounded-2xl border p-3 font-bold ${alert.tone === "bill" ? "border-red-200 bg-red-50 text-red-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>
              <span>{alert.message}</span>
              <button className="rounded-lg bg-white/70 px-2 py-1 text-xs" onClick={() => void acknowledgeAlert(alert)}>
                OK
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {(Object.keys(statusLabels) as TableStatus[]).map((status) => (
          <div key={status} className={`rounded-2xl border p-3 ${statusStyles[status]}`}>
            <p className="text-2xl font-black">{tables.filter((table) => table.status === status && table.active).length}</p>
            <p className="text-sm font-bold">{statusLabels[status]}</p>
          </div>
        ))}
      </section>

      <section className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${areaFilter === "all" ? "bg-ink text-white" : "bg-white/80"}`} onClick={() => setAreaFilter("all")}>
          Todos setores
        </button>
        {areas.map((area) => (
          <button key={area.id} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${areaFilter === area.id ? "bg-ink text-white" : "bg-white/80"}`} onClick={() => setAreaFilter(area.id)}>
            {area.name}
          </button>
        ))}
      </section>

      {loading ? (
        <section className="mt-4 rounded-3xl border bg-white/80 p-8 text-center">Carregando mesas...</section>
      ) : (
        <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filteredTables.map((table) => (
            <button
              key={table.id}
              className={`rounded-[2rem] border-2 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl ${table.activeSession?.waiterCalledAt ? "animate-pulse border-blue-600 bg-blue-100 text-blue-950 shadow-2xl shadow-blue-500/30 ring-4 ring-blue-300" : statusStyles[table.status]}`}
              onClick={() => void loadOrders(table)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide opacity-70">{table.area?.name || "Sem setor"}</p>
                  <h2 className="font-display text-5xl leading-none">Mesa {table.number}</h2>
                  <p className="mt-1 font-bold">{table.name || `${table.seats} lugares`}</p>
                </div>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-black">{table.activeSession?.waiterCalledAt ? "Chamou garÃ§om" : statusLabels[table.status]}</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl bg-white/65 p-3">
                  <p className="text-xs opacity-70">Pedidos</p>
                  <p className="text-xl font-black">{table.orderCount ?? table._count?.orders ?? 0}</p>
                </div>
                <div className="rounded-2xl bg-white/65 p-3">
                  <p className="text-xs opacity-70">QR Code</p>
                  <p className="truncate text-xs font-bold">
                    {table.activeSession?.status === "PENDING_CONFIRMATION" ? "Aguardando confirmaÃ§Ã£o" : table.activeSession ? "SessÃ£o ativa" : "Fechado"}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/65 p-3">
                  <p className="text-xs opacity-70">Conta atual</p>
                  <p className="truncate text-xs font-black">{brl(table.accountTotal ?? 0)}</p>
                </div>
                <div className={`rounded-2xl p-3 ${table.activeSession?.waiterCalledAt ? "bg-blue-100 text-blue-900" : "bg-white/65"}`}>
                  <p className="text-xs opacity-70">GarÃ§om</p>
                  <p className="truncate text-xs font-black">{table.activeSession?.waiterCalledAt ? "Chamado" : "-"}</p>
                </div>
              </div>
            </button>
          ))}
          {!filteredTables.length && (
            <div className="rounded-3xl border bg-white/80 p-8 text-center sm:col-span-2 lg:col-span-4">
              <p className="font-black">Nenhuma mesa encontrada.</p>
              <p className="mt-1 text-sm opacity-70">Cadastre mesas em â€œMesas / QR Codeâ€.</p>
            </div>
          )}
        </section>
      )}

      {selectedTable && (
        <section className="fixed inset-0 z-50 bg-black/50 p-3 md:flex md:items-center md:justify-center" onClick={() => setSelectedTable(null)}>
          <div className="mx-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[2rem] bg-white p-4 shadow-2xl dark:bg-slate-950" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Comanda aberta</p>
                <h2 className="font-display text-5xl leading-none">Mesa {selectedTable.number}</h2>
                <p className="text-sm opacity-70">{selectedTable.area?.name || "Sem setor"} â€¢ {statusLabels[selectedTable.status]}</p>
              </div>
              <button className="rounded-full bg-black/5 px-4 py-2 font-bold dark:bg-white/10" onClick={() => setSelectedTable(null)}>Fechar</button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/10">
                <p className="text-xs opacity-70">Pedidos</p>
                <p className="text-2xl font-black">{totals.count}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 p-3 dark:bg-white/10">
                <p className="text-xs opacity-70">Itens</p>
                <p className="text-2xl font-black">{totals.items}</p>
              </div>
              <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-900">
                <p className="text-xs opacity-70">Total</p>
                <p className="text-2xl font-black">{brl(accountTotals.total)}</p>
              </div>
            </div>

            {selectedTable.activeSession?.status !== "PENDING_CONFIRMATION" && selectedTable.activeSession && (
              <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Acesso do cliente</p>
                <div className="mt-2 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <p className="text-sm opacity-80">Mostre ou fale este codigo ao cliente para liberar o cardapio da mesa.</p>
                    <p className="mt-1 text-4xl font-black tracking-[0.18em]">{selectedTable.activeSession.shortCode}</p>
                  </div>
                  <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-black text-white" onClick={() => sendTableMenuWhatsapp(selectedTable)}>
                    Enviar cardapio no WhatsApp
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canManagePdv && selectedTable.activeSession?.status === "PENDING_CONFIRMATION" && (
                <button className="rounded-xl bg-blue-700 px-3 py-2 text-sm font-bold text-white" onClick={() => void approveSession(selectedTable)}>
                  Confirmar abertura
                </button>
              )}
              {canManagePdv && selectedTable.activeSession?.status === "CLOSING_REQUESTED" && (
                <button className="rounded-xl bg-blue-700 px-3 py-2 text-sm font-bold text-white" onClick={() => void reopenSession(selectedTable)}>
                  Reabrir conta
                </button>
              )}
              {canOpenPdv && !selectedTable.activeSession && (
                <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60" disabled={openingSession} onClick={() => void openSession(selectedTable)}>
                  {openingSession ? "Abrindo..." : "Abrir atendimento"}
                </button>
              )}
              {selectedTable.activeSession?.status !== "PENDING_CONFIRMATION" && (
                <a className="rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white" href={selectedTable.qrCodeUrl} target="_blank" rel="noreferrer">
                  Abrir QR/cardÃ¡pio
                </a>
              )}
              {selectedTable.activeSession?.status !== "PENDING_CONFIRMATION" && (
                <button className="rounded-xl bg-green-700 px-3 py-2 text-sm font-bold text-white" onClick={() => sendTableMenuWhatsapp(selectedTable)}>
                  Enviar cardapio
                </button>
              )}
              {canManagePdv && <button className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "OCCUPIED")}>Marcar ocupada</button>}
              {canManagePdv && selectedTable.activeSession?.status !== "CLOSING_REQUESTED" && (
                <button className="rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "WAITING_PAYMENT")}>Solicitou conta</button>
              )}
              <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => void printTableAccount()}>Imprimir prÃ©-conta</button>
              <button className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white" onClick={() => void updateStatus(selectedTable, "FREE")}>Liberar mesa</button>
              {canManagePdv && selectedTable.activeSession && (
                <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => setShowMovePanel((value) => !value)}>Transferir/juntar</button>
              )}
              {canHistoryPdv && (
                <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => setShowHistoryPanel((value) => !value)}>Historico</button>
              )}
            </div>

            {canManagePdv && selectedTable.activeSession && showMovePanel && (
              <section className="mt-4 rounded-3xl border bg-slate-50 p-4 text-slate-950">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-64 flex-1">
                    <span className="mb-1 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Mover comanda</span>
                    <select className="w-full rounded-xl border px-3 py-2" value={targetTableId} onChange={(event) => setTargetTableId(event.target.value)}>
                      <option value="">Escolha a mesa destino</option>
                      {tables
                        .filter((table) => table.id !== selectedTable.id && table.active)
                        .sort((a, b) => a.number - b.number)
                        .map((table) => (
                          <option key={table.id} value={table.id}>
                            Mesa {table.number} - {statusLabels[table.status]} - {brl(table.accountTotal ?? 0)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button className="rounded-xl bg-blue-700 px-3 py-2 text-sm font-black text-white disabled:opacity-60" disabled={!targetTableId || movingTable} onClick={() => void moveSelectedTable("TRANSFER")}>
                    Transferir
                  </button>
                  <button className="rounded-xl bg-purple-700 px-3 py-2 text-sm font-black text-white disabled:opacity-60" disabled={!targetTableId || movingTable} onClick={() => void moveSelectedTable("MERGE")}>
                    Juntar mesas
                  </button>
                </div>
                <p className="mt-2 text-xs opacity-70">
                  Transferir move a comanda para uma mesa livre. Juntar soma os pedidos desta mesa em outra mesa aberta.
                </p>
              </section>
            )}

            {canHistoryPdv && showHistoryPanel && <section className="mt-4 rounded-3xl border bg-white p-4 text-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Historico</p>
                  <h3 className="text-lg font-black">Atendimentos fechados</h3>
                  <p className="text-xs opacity-70">Reimprima recibos e pre-contas antigas desta mesa.</p>
                </div>
                <button className="rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-60" disabled={loadingHistory} onClick={() => void loadTableHistory(selectedTable)}>
                  {loadingHistory ? "Carregando..." : "Atualizar historico"}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {closedSessions.length ? closedSessions.map((session) => (
                  <div key={session.id} className="rounded-2xl border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-black">Atendimento #{session.shortCode} - {brl(session.total)}</p>
                        <p className="text-xs opacity-70">
                          Fechado em {session.closedAt ? formatDate(session.closedAt) : "-"} | {session.orderCount} pedido(s) | {session.itemCount} item(ns)
                        </p>
                        <p className="text-xs opacity-70">
                          Cliente: {session.customerName || "-"} {session.customerPhone ? `- ${session.customerPhone}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button className="rounded-xl border px-3 py-2 text-xs font-black" onClick={() => void reprintClosedSession(session, "PRE_BILL")}>
                          Reimprimir pre-conta
                        </button>
                        <button className="rounded-xl bg-ink px-3 py-2 text-xs font-black text-white" onClick={() => void reprintClosedSession(session, "RECEIPT")}>
                          Reimprimir recibo
                        </button>
                      </div>
                    </div>
                  </div>
                )) : (
                  <p className="rounded-2xl bg-slate-50 p-3 text-sm opacity-70">Nenhum atendimento fechado encontrado para esta mesa.</p>
                )}
              </div>
            </section>}

            {canAuditPdv && <section className="mt-4 rounded-3xl border bg-white p-4 text-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Auditoria</p>
                  <h3 className="text-lg font-black">Rastro operacional do PDV</h3>
                  <p className="text-xs opacity-70">Veja quem abriu, cancelou, transferiu, juntou ou fechou comandas.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={auditOnlySelectedTable}
                      onChange={(event) => setAuditOnlySelectedTable(event.target.checked)}
                    />
                    Apenas esta mesa
                  </label>
                  <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => setShowAuditPanel((value) => !value)}>
                    {showAuditPanel ? "Ocultar" : "Ver auditoria"}
                  </button>
                  {showAuditPanel && (
                    <button className="rounded-xl bg-ink px-3 py-2 text-sm font-bold text-white disabled:opacity-60" disabled={loadingAudit} onClick={() => void loadPdvAudit()}>
                      {loadingAudit ? "Carregando..." : "Atualizar"}
                    </button>
                  )}
                </div>
              </div>
              {showAuditPanel && (
                <div className="mt-3 space-y-2">
                  {!auditLogs.length && !loadingAudit && (
                    <p className="rounded-2xl bg-slate-50 p-3 text-sm opacity-70">Nenhum evento de auditoria encontrado.</p>
                  )}
                  {auditLogs.map((log) => (
                    <article key={log.id} className="rounded-2xl border bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-black">{auditActionLabel(log.action)}</p>
                          <p className="text-sm opacity-80">{auditDescription(log)}</p>
                          <p className="mt-1 text-xs opacity-60">
                            {formatDate(log.createdAt)} | UsuÃ¡rio: {log.userName || log.userId || "Sistema"} {log.ipAddress ? `| IP ${log.ipAddress}` : ""}
                          </p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600">{log.entity}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>}

            {selectedTable.activeSession && (selectedTable.activeSession.status === "PENDING_CONFIRMATION" || showQrPanel) && (
              <section className="mt-4 rounded-3xl border bg-white p-4 text-slate-950">
                {selectedTable.activeSession.status === "PENDING_CONFIRMATION" && (
                  <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                    <p className="text-xs font-black uppercase tracking-[0.18em]">SolicitaÃ§Ã£o do cliente</p>
                    <p className="mt-1 font-black">{selectedTable.activeSession.customerName || "Cliente"}</p>
                    <p className="text-sm opacity-80">{selectedTable.activeSession.customerPhone || "-"} - {selectedTable.activeSession.customerEmail || "-"}</p>
                    <p className="mt-2 text-sm">Confirme apenas se o cliente estiver presente na mesa. O QR Code e o codigo aparecem depois da confirmacao.</p>
                  </div>
                )}
                {selectedTable.activeSession.status !== "PENDING_CONFIRMATION" && (
                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                  <img className="h-44 w-44 rounded-2xl bg-white p-2 shadow" src={qrImage(selectedTable.activeSession.sessionUrl)} alt={`QR Code mesa ${selectedTable.number}`} />
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Atendimento seguro</p>
                    <h3 className="text-2xl font-black">CÃ³digo: {selectedTable.activeSession.shortCode}</h3>
                    <p className="mt-1 text-sm opacity-70">Mostre este cÃ³digo ao cliente. O QR Code sÃ³ funciona enquanto este atendimento estiver aberto.</p>
                    <p className="mt-2 break-all rounded-xl bg-slate-100 p-2 text-xs">{selectedTable.activeSession.sessionUrl}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => {
                        void navigator.clipboard.writeText(selectedTable.activeSession?.sessionUrl ?? "");
                        toast.success("Link copiado");
                      }}>
                        Copiar link
                      </button>
                      <a className="rounded-xl border px-3 py-2 text-sm font-bold" href={qrImage(selectedTable.activeSession.sessionUrl)} target="_blank" rel="noreferrer">
                        Imprimir/abrir QR
                      </a>
                    </div>
                  </div>
                </div>
                )}
              </section>
            )}

            {canClosePdv && <section className="mt-5 rounded-3xl border bg-emerald-50 p-4 text-slate-950">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Fechamento</p>
                  <h3 className="text-xl font-black">Fechar conta da mesa</h3>
                  <p className="text-sm opacity-70">Total atual: {brl(accountTotals.total)}</p>
                </div>
                <button className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-black text-white" onClick={() => setShowClosePanel((value) => !value)}>
                  {showClosePanel ? "Ocultar fechamento" : "Receber / fechar"}
                </button>
              </div>
              {showClosePanel && (
              <>
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                <div className="rounded-2xl bg-white p-3">
                  <p className="text-xs opacity-70">Subtotal</p>
                  <p className="font-black">{brl(accountTotals.subtotal)}</p>
                </div>
                <label className="rounded-2xl bg-white p-3">
                  <span className="flex items-center gap-2 text-xs font-bold">
                    <input type="checkbox" checked={serviceFeeEnabled} onChange={(event) => setServiceFeeEnabled(event.target.checked)} />
                    Taxa de serviÃ§o
                  </span>
                  <div className="mt-1 grid grid-cols-[1fr_64px] gap-1">
                    <input
                      className="w-full rounded-lg border px-2 py-1 text-sm"
                      type="number"
                      min={0}
                      step="0.01"
                      value={serviceFeeType === "PERCENT" ? serviceFeePercent : serviceFeeAmount}
                      onChange={(event) => {
                        const value = Number(event.target.value || 0);
                        if (serviceFeeType === "PERCENT") setServiceFeePercent(value);
                        else setServiceFeeAmount(value);
                      }}
                    />
                    <select className="rounded-lg border px-1 py-1 text-sm" value={serviceFeeType} onChange={(event) => setServiceFeeType(event.target.value as ServiceFeeType)}>
                      <option value="PERCENT">%</option>
                      <option value="FIXED">R$</option>
                    </select>
                  </div>
                  <p className="text-xs font-bold">{brl(accountTotals.serviceFee)}</p>
                </label>
                <label className="rounded-2xl bg-white p-3">
                  <span className="text-xs font-bold">Desconto</span>
                  <input className="mt-1 w-full rounded-lg border px-2 py-1 text-sm" type="number" min={0} value={closeDiscount} onChange={(event) => setCloseDiscount(Number(event.target.value || 0))} />
                </label>
                <div className="rounded-2xl bg-emerald-100 p-3">
                  <p className="text-xs opacity-70">Total final</p>
                  <p className="text-xl font-black">{brl(accountTotals.total)}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1.5fr_auto]">
                <select className="rounded-xl border px-3 py-2" value={closePaymentMethod} onChange={(event) => setClosePaymentMethod(event.target.value as ClosePaymentMethod)}>
                  <option value="PIX">Pix</option>
                  <option value="CASH">Dinheiro</option>
                  <option value="DEBIT">CartÃ£o DÃ©bito</option>
                  <option value="CREDIT">CartÃ£o CrÃ©dito</option>
                  <option value="CARD">CartÃ£o</option>
                </select>
                <input className="rounded-xl border px-3 py-2" placeholder="ObservaÃ§Ã£o do fechamento opcional" value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} />
                <button
                  className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-60"
                  disabled={closingTable || totals.count === 0}
                  onClick={() => void closeTableAccount()}
                >
                  {closingTable ? "Fechando..." : "Receber e liberar"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-black text-emerald-800" onClick={() => setShowPaymentSplitPanel((value) => !value)}>
                  Pagamento dividido
                </button>
                <button type="button" className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-black text-blue-800" onClick={() => setShowBillSplitPanel((value) => !value)}>
                  Dividir por pessoas
                </button>
              </div>
              {showPaymentSplitPanel && <div className="mt-3 rounded-2xl border border-emerald-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Pagamento dividido</p>
                    <p className="text-xs opacity-70">Use quando a conta for paga em mais de uma forma.</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl bg-ink px-3 py-2 text-xs font-black text-white"
                    onClick={() => addSplitPayment()}
                  >
                    Adicionar pagamento
                  </button>
                </div>

                {splitPayments.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {splitPayments.map((payment, index) => (
                      <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                        <select
                          className="rounded-xl border px-3 py-2"
                          value={payment.method}
                          onChange={(event) => updateSplitPayment(index, { method: event.target.value as ClosePaymentMethod })}
                        >
                          <option value="PIX">Pix</option>
                          <option value="CASH">Dinheiro</option>
                          <option value="DEBIT">CartÃ£o DÃ©bito</option>
                          <option value="CREDIT">CartÃ£o CrÃ©dito</option>
                          <option value="CARD">CartÃ£o</option>
                        </select>
                        <input
                          className="rounded-xl border px-3 py-2"
                          type="number"
                          min={0}
                          step="0.01"
                          value={payment.amount}
                          onChange={(event) => updateSplitPayment(index, { amount: Number(event.target.value || 0) })}
                        />
                        <button
                          type="button"
                          className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700"
                          onClick={() => removeSplitPayment(index)}
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                    <div className={`rounded-xl p-3 text-sm font-bold ${splitIsBalanced ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                      <p>Total da conta: {brl(accountTotals.total)}</p>
                      <p>Total informado: {brl(splitPaidTotal)}</p>
                      <p>
                        {splitIsBalanced
                          ? "Pagamentos conferidos."
                          : splitDifference < 0
                            ? `Falta receber ${brl(splitRemaining)}.`
                            : `Sobra ${brl(splitDifference)}.`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs opacity-70">Sem divisÃ£o: serÃ¡ usado apenas o mÃ©todo selecionado acima.</p>
                )}
              </div>
              }<p className="mt-2 text-xs opacity-70">Importante: Ã© necessÃ¡rio ter caixa aberto para o operador logado.</p>
              {showBillSplitPanel && <div className="mt-3 rounded-2xl border border-blue-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Divisao da conta</p>
                    <p className="text-xs opacity-70">Divida por item ou informe quanto cada pessoa vai pagar.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-black text-white" onClick={addBillPerson}>Adicionar pessoa</button>
                    <button type="button" className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-800" onClick={() => void copyBillSplit()}>Copiar divisao</button>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl bg-blue-50 p-3 text-sm font-bold text-blue-900">
                  Informe as pessoas e quanto cada uma vai pagar. O restante e redistribuido automaticamente.
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {billPeople.map((person, index) => (
                    <div key={index} className="grid grid-cols-[1fr_auto] gap-2">
                      <input className="rounded-xl border px-3 py-2 text-sm" value={person} onChange={(event) => updateBillPerson(index, event.target.value)} placeholder={`Pessoa ${index + 1}`} />
                      <button type="button" className="rounded-xl border border-red-200 px-3 py-2 text-xs font-black text-red-700 disabled:opacity-40" disabled={billPeople.length <= 1} onClick={() => removeBillPerson(index)}>Remover</button>
                    </div>
                  ))}
                </div>
                {billSplitMode === "VALUE" && (
                  <div className="mt-3 rounded-2xl border border-blue-100 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-black">Valores por pessoa</p>
                        <p className="text-xs opacity-70">Total da conta: {brl(accountTotals.total)}. Ajuste os valores se alguem pagar mais ou menos.</p>
                      </div>
                      <button type="button" className="rounded-xl border border-blue-200 px-3 py-2 text-xs font-black text-blue-800" onClick={() => setValueSplitAmounts(distributeAccountByPeople())}>
                        Dividir igual
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {billPeople.map((person, index) => (
                        <label key={index} className="rounded-2xl bg-slate-50 p-3">
                          <span className="text-xs font-bold opacity-70">{person || `Pessoa ${index + 1}`}</span>
                          <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_140px]">
                            <input
                              className="w-full rounded-xl border px-3 py-2 font-black"
                              type="number"
                              min={0}
                              step="0.01"
                              value={valueSplitAmounts[index] ?? 0}
                              onChange={(event) => updateValueSplitAmount(index, Number(event.target.value || 0))}
                            />
                            <select
                              className="rounded-xl border px-3 py-2 text-sm"
                              value={valueSplitMethods[index] ?? closePaymentMethod}
                              onChange={(event) => updateValueSplitMethod(index, event.target.value as ClosePaymentMethod)}
                            >
                              <option value="PIX">Pix</option>
                              <option value="CASH">Dinheiro</option>
                              <option value="DEBIT">Debito</option>
                              <option value="CREDIT">Credito</option>
                              <option value="CARD">Cartao</option>
                            </select>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className={`mt-3 rounded-xl p-3 text-sm font-bold ${billSplitValueBalanced ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                      <p>Total distribuido: {brl(billSplitValueTotal)}</p>
                      <p>
                        {billSplitValueBalanced
                          ? "Divisao por valor conferida."
                          : billSplitValueDifference < 0
                            ? `Falta redistribuir ${brl(Math.abs(billSplitValueDifference))}.`
                            : `Sobra ${brl(Math.abs(billSplitValueDifference))}.`}
                      </p>
                    </div>
                  </div>
                )}
                {billSplitMode === "ITEMS" && <div className="mt-3 space-y-2">
                  {orders.filter((order) => order.status !== "CANCELED").flatMap((order) =>
                    order.items.map((item) => (
                      <div key={item.id} className="grid gap-2 rounded-2xl bg-slate-50 p-3 text-sm md:grid-cols-[1fr_180px]">
                        <div>
                          <p className="font-black">Pedido #{String(order.orderNumber).padStart(5, "0")} - {item.quantity}x {item.product.name}</p>
                          <p className="text-xs opacity-70">{brl(item.total)}</p>
                        </div>
                        <select className="rounded-xl border px-3 py-2" value={itemSplitAssignments[item.id] ?? 0} onChange={(event) => setItemSplitAssignments((current) => ({ ...current, [item.id]: Number(event.target.value) }))}>
                          {billPeople.map((person, personIndex) => (
                            <option key={personIndex} value={personIndex}>{person || `Pessoa ${personIndex + 1}`}</option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                  {!orders.some((order) => order.status !== "CANCELED" && order.items.length > 0) && (
                    <p className="rounded-xl bg-slate-50 p-3 text-sm opacity-70">Nenhum item para dividir.</p>
                  )}
                </div>}
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {billSplit.map((person, index) => (
                    <div key={index} className="rounded-2xl border bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <strong>{person.name}</strong>
                        <strong className="text-blue-700">{brl(person.total)}</strong>
                      </div>
                      <p className="mt-1 text-xs opacity-70">Itens: {person.items.length} | Subtotal {brl(person.subtotal)}</p>
                      {(person.serviceFee > 0 || person.discount > 0) && (
                        <p className="text-xs opacity-70">Taxa {brl(person.serviceFee)} / Desconto {brl(person.discount)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>}
                           </>
              )}
</section>}

            {canOpenPdv && <section className="mt-5 rounded-3xl border-2 border-orange-200 bg-orange-50 p-4 text-slate-950 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-ember">GarÃ§om / PDV</p>
                  <h3 className="text-xl font-black">Adicionar itens na mesa</h3>
                </div>
                <strong className="rounded-full bg-white px-3 py-1 text-ember">{brl(draftTotal)}</strong>
              </div>

              {!tableCanReceiveOrders && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
                  Abra/libere o atendimento da mesa para adicionar produtos.
                </div>
              )}

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1.3fr_100px_140px]">
                <input
                  className="rounded-xl border px-3 py-2 disabled:opacity-60"
                  placeholder="Buscar produto"
                  value={draftProductSearch}
                  disabled={!tableCanReceiveOrders}
                  onChange={(event) => setDraftProductSearch(event.target.value)}
                />
                <select className="rounded-xl border px-3 py-2 disabled:opacity-60" value={draftProductId} disabled={!tableCanReceiveOrders} onChange={(event) => setDraftProductId(event.target.value)}>
                  <option value="">Escolha um produto</option>
                  {filteredProductsForDraft.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} - {brl(product.promoPrice ?? product.price)}
                    </option>
                  ))}
                </select>
                <input className="rounded-xl border px-3 py-2 disabled:opacity-60" type="number" min={1} value={draftQuantity} disabled={!tableCanReceiveOrders} onChange={(event) => setDraftQuantity(Math.max(1, Number(event.target.value || 1)))} />
                <button className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-lg font-black text-white shadow-lg shadow-emerald-900/20 disabled:opacity-60" disabled={!tableCanReceiveOrders} onClick={addDraftItem}>Adicionar item</button>
              </div>

              <input className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="Nome do cliente opcional" value={draftCustomerName} onChange={(event) => setDraftCustomerName(event.target.value)} />
              <textarea className="mt-2 w-full rounded-xl border px-3 py-2" placeholder="ObservaÃ§Ã£o da cozinha: sem cebola, ponto da carne, etc." value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />

              {draftItems.length > 0 && (
                <div className="mt-3 space-y-2">
                  {draftItems.map((item) => {
                    const product = products.find((candidate) => candidate.id === item.productId);
                    if (!product) return null;
                    const complementTotal = item.complements.reduce((sum, selected) => {
                      const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
                      return sum + Number(link?.complement.price ?? 0) * selected.quantity;
                    }, 0);
                    const itemTotal = (Number(product.promoPrice ?? product.price) + complementTotal) * item.quantity;
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3">
                        <div>
                          <p className="font-black">{item.quantity}x {product.name}</p>
                          {item.complements.map((selected) => {
                            const link = product.complements?.find((candidate) => candidate.complementId === selected.complementId);
                            if (!link) return null;
                            return <p key={selected.complementId} className="text-xs opacity-70">+ {selected.quantity}x {link.complement.name}</p>;
                          })}
                          <p className="text-sm opacity-70">{brl(itemTotal)}</p>
                        </div>
                        <button className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white" onClick={() => setDraftItems((current) => current.filter((draft) => draft.id !== item.id))}>
                          Remover
                        </button>
                      </div>
                    );
                  })}
                  <button className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white disabled:opacity-60" disabled={savingOrder} onClick={() => void createTableOrder()}>
                    {savingOrder ? "Enviando..." : "Enviar pedido para cozinha"}
                  </button>
                </div>
              )}
            </section>}

            <div className="mt-5 space-y-3">
              {loadingOrders ? (
                <p className="rounded-2xl border p-4">Carregando pedidos...</p>
              ) : orders.length ? (
                orders.map((order) => (
                  <article key={order.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-black">Pedido #{String(order.orderNumber).padStart(5, "0")}</p>
                        <p className="text-xs opacity-65">{formatDate(order.createdAt)} â€¢ {orderStatusLabels[order.status]}</p>
                      </div>
                      <p className="text-lg font-black text-ember">{brl(order.total)}</p>
                    </div>
                    <div className="mt-3 space-y-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/5">
                          <div className="flex justify-between gap-3">
                            <span><strong>{item.quantity}x</strong> {item.product.name}</span>
                            <strong>{brl(item.total)}</strong>
                          </div>
                          {item.complements.map((complement) => (
                            <p key={complement.id} className="ml-4 text-xs opacity-65">+ {complement.quantity}x {complement.name}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(["RECEIVED", "PREPARING", "CANCELED"] as TableOrder["status"][]).map((status) => (
                        <button key={status} className="rounded-lg border px-3 py-2 text-xs font-bold" onClick={() => void updateOrderStatus(order, status)}>
                          {orderStatusLabels[status]}
                        </button>
                      ))}
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed p-6 text-center">
                  <p className="font-black">Nenhum pedido aberto nesta mesa.</p>
                  <p className="mt-1 text-sm opacity-70">Abra o cardÃ¡pio da mesa ou leia o QR Code para criar o primeiro pedido.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {configuringProduct && (
        <section className="fixed inset-0 z-[60] bg-black/60 p-3 md:flex md:items-center md:justify-center" onClick={() => setConfiguringProduct(null)}>
          <div className="mx-auto max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[2rem] bg-white p-4 shadow-2xl dark:bg-slate-950" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ember">Montar item</p>
                <h2 className="text-2xl font-black">{configuringProduct.name}</h2>
                <p className="mt-1 text-sm opacity-70">Base: {brl(configuringProduct.promoPrice ?? configuringProduct.price)}</p>
              </div>
              <button className="rounded-full bg-black/5 px-4 py-2 font-bold dark:bg-white/10" onClick={() => setConfiguringProduct(null)}>Fechar</button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl bg-orange-50 p-3 text-slate-950">
              <span className="font-black">Quantidade</span>
              <div className="flex items-center gap-2">
                <button className="grid h-9 w-9 place-items-center rounded-full bg-white font-black" disabled={configuringQuantity <= 1} onClick={() => setConfiguringQuantity((value) => Math.max(1, value - 1))}>-</button>
                <strong className="min-w-8 text-center">{configuringQuantity}</strong>
                <button className="grid h-9 w-9 place-items-center rounded-full bg-ink font-black text-white" onClick={() => setConfiguringQuantity((value) => value + 1)}>+</button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(configuringProduct.complements ?? []).filter((link) => link.complement.active).length ? (
                (configuringProduct.complements ?? []).filter((link) => link.complement.active).map((link) => {
                  const quantity = configuringComplements[link.complementId] ?? 0;
                  return (
                    <article key={link.id} className={`rounded-2xl border p-3 ${quantity ? "border-ember bg-orange-50 text-slate-950" : "border-black/10 dark:border-white/10"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black">{link.complement.name}</p>
                          {link.complement.description && <p className="text-xs opacity-65">{link.complement.description}</p>}
                          <p className="mt-1 text-sm font-bold text-ember">{Number(link.complement.price) > 0 ? `+ ${brl(link.complement.price)}` : "Sem adicional"}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[11px] font-black ${link.required ? "bg-red-100 text-red-700" : "bg-black/5 dark:bg-white/10"}`}>
                          {link.required ? "Obrigatorio" : "Opcional"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full bg-black/10 font-black disabled:opacity-40"
                          disabled={link.required && quantity <= 1}
                          onClick={() => setConfiguringComplements((current) => ({ ...current, [link.complementId]: Math.max(link.required ? 1 : 0, quantity - 1) }))}
                        >
                          -
                        </button>
                        <strong className="min-w-8 text-center">{quantity}</strong>
                        <button
                          className="grid h-9 w-9 place-items-center rounded-full bg-ink font-black text-white"
                          onClick={() => setConfiguringComplements((current) => ({ ...current, [link.complementId]: quantity + 1 }))}
                        >
                          +
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed p-4 text-sm opacity-70">Este produto nao possui complementos.</div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-slate-100 p-3 text-slate-950">
              <div>
                <p className="text-xs font-bold uppercase opacity-60">Total do item</p>
                <p className="text-2xl font-black text-ember">{brl(configuringTotal)}</p>
              </div>
              <button className="rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white" onClick={confirmConfiguredItem}>
                Adicionar Ã  comanda
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
