type ReceiptItem = {
  quantity: number;
  total?: number;
  product: { name: string };
  complements?: Array<{ name: string; quantity: number; price?: number }>;
};

export type ReceiptOrder = {
  orderNumber: number;
  createdAt: string;
  fulfillmentType: "DELIVERY" | "PICKUP";
  paymentMethod?: "CASH" | "PIX" | "CARD";
  paidMethodDetail?: string | null;
  changeFor?: number | null;
  subtotal?: number;
  deliveryFee?: number;
  discount?: number;
  total: number;
  customerNotes?: string | null;
  customer: {
    name: string;
    phone: string;
    address: string;
    number: string;
    district: string;
    complement?: string | null;
  };
  items: ReceiptItem[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: unknown) {
  return `R$ ${Number(value ?? 0).toFixed(2).replace(".", ",")}`;
}

function openPrintWindow(content: string, paperWidth: 58 | 80) {
  const popup = window.open("", "_blank", "width=480,height=720");
  if (!popup) {
    throw new Error("O navegador bloqueou a janela de impressao. Libere pop-ups para este site.");
  }
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Impressao</title>
  <style>
    @page { size: ${paperWidth}mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body { width: ${paperWidth - 6}mm; margin: 0; color: #000; background: #fff; font: 12px/1.35 "Courier New", monospace; }
    h1, h2, p { margin: 0 0 5px; }
    h1 { font-size: 16px; text-align: center; }
    h2 { font-size: 14px; text-align: center; }
    .center { text-align: center; }
    .line { border-top: 1px dashed #000; margin: 7px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .item { margin-bottom: 5px; }
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

export function orderReceiptHtml(
  order: ReceiptOrder,
  options: { companyName: string }
) {
  const delivery = order.fulfillmentType === "DELIVERY";
  const items = order.items.map((item) => `
    <div class="item">
      <div class="row"><strong>${item.quantity}x ${escapeHtml(item.product.name)}</strong><span>${money(item.total)}</span></div>
      ${(item.complements ?? []).map((complement) =>
        `<div>+ ${complement.quantity}x ${escapeHtml(complement.name)}${Number(complement.price ?? 0) > 0 ? ` (${money(complement.price)})` : ""}</div>`
      ).join("")}
    </div>`).join("");
  const payment = order.paidMethodDetail
    ?? (order.paymentMethod === "CASH" ? "Dinheiro" : order.paymentMethod === "PIX" ? "PIX" : "Cartao");

  return `
    <h1>${escapeHtml(options.companyName).toUpperCase()}</h1>
    <h2>PEDIDO #${String(order.orderNumber).padStart(5, "0")}</h2>
    <p class="center">${escapeHtml(new Date(order.createdAt).toLocaleString("pt-BR"))}</p>
    <div class="line"></div>
    <p><strong>Cliente:</strong> ${escapeHtml(order.customer.name)}</p>
    <p><strong>Telefone:</strong> ${escapeHtml(order.customer.phone)}</p>
    <p><strong>${delivery ? "ENTREGA" : "RETIRADA NA LOJA"}</strong></p>
    ${delivery ? `
      <p>${escapeHtml(order.customer.address)}, ${escapeHtml(order.customer.number)}</p>
      <p>${escapeHtml(order.customer.district)}</p>
      ${order.customer.complement ? `<p>Comp: ${escapeHtml(order.customer.complement)}</p>` : ""}
    ` : ""}
    <div class="line"></div>
    ${items}
    <div class="line"></div>
    <div class="row"><span>Subtotal</span><span>${money(order.subtotal ?? order.total)}</span></div>
    <div class="row"><span>Frete</span><span>${money(order.deliveryFee)}</span></div>
    <div class="row"><span>Desconto</span><span>${money(order.discount)}</span></div>
    <div class="row total"><span>TOTAL</span><span>${money(order.total)}</span></div>
    <p><strong>Pagamento:</strong> ${escapeHtml(payment)}</p>
    ${order.changeFor ? `<p><strong>Troco para:</strong> ${money(order.changeFor)}</p>` : ""}
    ${order.customerNotes ? `<div class="line"></div><p><strong>Obs:</strong> ${escapeHtml(order.customerNotes)}</p>` : ""}
    <br /><br />
  `;
}

export function printOrderInBrowser(
  order: ReceiptOrder,
  options: { companyName: string; paperWidth: 58 | 80 }
) {
  openPrintWindow(orderReceiptHtml(order, options), options.paperWidth);
}

export function testReceiptHtml(companyName: string) {
  return `
    <h1>${escapeHtml(companyName || "Delivery")}</h1>
    <h2>TESTE DE IMPRESSAO</h2>
    <div class="line"></div>
    <p>Impressora conectada com sucesso ao painel.</p>
    <p class="center">${escapeHtml(new Date().toLocaleString("pt-BR"))}</p>
    <br /><br />
  `;
}

export function printTestReceipt(companyName: string, paperWidth: 58 | 80) {
  openPrintWindow(testReceiptHtml(companyName), paperWidth);
}
