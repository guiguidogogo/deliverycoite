import type { FulfillmentType, PaymentMethod, Setting } from "@prisma/client";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { formatOrderCode } from "../utils/order-code.js";

const execFileAsync = promisify(execFile);

type PrintableOrder = {
  orderNumber: number;
  fulfillmentType: FulfillmentType;
  paymentMethod: PaymentMethod;
  changeFor: unknown;
  subtotal: unknown;
  deliveryFee: unknown;
  discount: unknown;
  total: unknown;
  customerNotes: string | null;
  createdAt: Date;
  customer: {
    name: string;
    phone: string;
    address: string;
    number: string;
    district: string;
    complement: string | null;
  };
  items: Array<{
    quantity: number;
    total: unknown;
    product: { name: string };
    complements: Array<{
      name: string;
      quantity: number;
      price: unknown;
    }>;
  }>;
};

function money(value: unknown) {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function separator(width: number) {
  return "-".repeat(width);
}

function receiptText(order: PrintableOrder, settings: Setting) {
  const width = settings.printerPaperWidth === 80 ? 48 : 32;
  const payment =
    order.paymentMethod === "CASH"
      ? "Dinheiro"
      : order.paymentMethod === "PIX"
        ? "PIX"
        : order.paymentMethod === "MERCADO_PAGO"
          ? "Mercado Pago"
        : "Cartao";
  const lines = [
    settings.companyName.toUpperCase(),
    `PEDIDO #${formatOrderCode(order.orderNumber)}`,
    order.createdAt.toLocaleString("pt-BR"),
    separator(width),
    `Cliente: ${order.customer.name}`,
    `Telefone: ${order.customer.phone}`,
    order.fulfillmentType === "PICKUP" ? "RETIRADA NA LOJA" : "ENTREGA",
    ...(order.fulfillmentType === "DELIVERY"
      ? [
          `${order.customer.address}, ${order.customer.number}`,
          order.customer.district,
          ...(order.customer.complement ? [`Comp: ${order.customer.complement}`] : [])
        ]
      : []),
    separator(width),
    ...order.items.flatMap((item) => [
      `${item.quantity}x ${item.product.name}  ${money(item.total)}`,
      ...item.complements.map((complement) =>
        `  + ${complement.quantity}x ${complement.name}${Number(complement.price) > 0 ? ` ${money(complement.price)}` : ""}`
      )
    ]),
    separator(width),
    `Subtotal: ${money(order.subtotal)}`,
    `Frete: ${money(order.deliveryFee)}`,
    `Desconto: ${money(order.discount)}`,
    `TOTAL: ${money(order.total)}`,
    `Pagamento: ${payment}`,
    ...(order.changeFor ? [`Troco para: ${money(order.changeFor)}`] : []),
    ...(order.customerNotes ? [separator(width), `Obs: ${order.customerNotes}`] : []),
    "",
    "",
    ""
  ];

  return lines.join("\r\n");
}

export async function listSystemPrinters() {
  if (process.platform !== "win32") return [];

  const script = [
    "$names = @()",
    "try { $names += Get-Printer -ErrorAction Stop | Select-Object -ExpandProperty Name } catch {}",
    "try {",
    "  $devices = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices' -ErrorAction Stop",
    "  $names += $devices.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and $_.Name -notlike 'PS*' } | Select-Object -ExpandProperty Name",
    "} catch {}",
    "try { $names += Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers' -ErrorAction Stop | Select-Object -ExpandProperty PSChildName } catch {}",
    "$names | Where-Object { $_ } | Sort-Object -Unique | ConvertTo-Json -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]);
  const output = stdout.trim();
  if (!output) return [];

  const parsed = JSON.parse(output) as string | string[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function printOrder(order: PrintableOrder, settings: Setting) {
  if (!settings.printerEnabled) {
    throw new Error("Impressao desabilitada nas configuracoes");
  }
  if (!settings.printerName?.trim()) {
    throw new Error("Selecione uma impressora nas configuracoes");
  }
  if (process.platform !== "win32") {
    throw new Error("Impressao direta disponivel apenas no servidor Windows");
  }

  const filePath = path.join(tmpdir(), `delivery-${randomUUID()}.txt`);
  await writeFile(filePath, receiptText(order, settings), "utf8");

  try {
    const script = [
      "$file = $env:DELIVERY_PRINT_FILE",
      "$printer = $env:DELIVERY_PRINTER_NAME",
      "Get-Content -LiteralPath $file -Raw -Encoding UTF8 | Out-Printer -Name $printer"
    ].join("; ");

    try {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script
      ], {
        env: {
          ...process.env,
          DELIVERY_PRINT_FILE: filePath,
          DELIVERY_PRINTER_NAME: settings.printerName
        }
      });
    } catch (error) {
      const detail =
        error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
          ? error.stderr.trim()
          : "";
      throw new Error(
        `Falha ao imprimir em "${settings.printerName}". ${detail || "Verifique se a impressora esta instalada e online."}`
      );
    }
  } finally {
    await unlink(filePath).catch(() => undefined);
  }
}
