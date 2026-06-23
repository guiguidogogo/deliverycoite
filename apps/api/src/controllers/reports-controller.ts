import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";
import { companyWhere } from "../utils/tenant.js";

function getDateRange(req: Request) {
  const dateFrom = req.query.dateFrom?.toString();
  const dateTo = req.query.dateTo?.toString();

  if (!dateFrom && !dateTo) {
    return {};
  }

  return {
    createdAt: {
      ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00-03:00`) } : {}),
      ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999-03:00`) } : {})
    }
  };
}

export async function exportOrdersExcel(req: Request, res: Response) {
  const orders = await prisma.order.findMany({
    where: { ...companyWhere(req), ...getDateRange(req) },
    include: { customer: true },
    orderBy: { createdAt: "desc" }
  });

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Pedidos");

  sheet.columns = [
    { header: "ID", key: "id", width: 24 },
    { header: "Cliente", key: "customer", width: 24 },
    { header: "Telefone", key: "phone", width: 18 },
    { header: "Status", key: "status", width: 18 },
    { header: "Total", key: "total", width: 12 },
    { header: "Criado em", key: "createdAt", width: 22 }
  ];

  orders.forEach((order) => {
    sheet.addRow({
      id: formatOrderCode(order.orderNumber),
      customer: order.customer.name,
      phone: order.customer.phone,
      status: order.status,
      total: Number(order.total),
      createdAt: order.createdAt.toISOString()
    });
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=pedidos.xlsx");

  await wb.xlsx.write(res);
  res.end();
}

export async function exportOrdersPdf(req: Request, res: Response) {
  const orders = await prisma.order.findMany({
    where: { ...companyWhere(req), ...getDateRange(req) },
    include: { customer: true },
    orderBy: { createdAt: "desc" }
  });

  const doc = new PDFDocument({ margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=pedidos.pdf");

  doc.pipe(res);
  doc.fontSize(18).text("Relatorio de Pedidos", { align: "center" });
  doc.moveDown();

  orders.forEach((order) => {
    doc
      .fontSize(11)
      .text(`#${formatOrderCode(order.orderNumber)} | ${order.createdAt.toLocaleString("pt-BR")} | ${order.customer.name} | ${order.status} | R$ ${Number(order.total).toFixed(2)}`);
  });

  doc.end();
}

async function financialEntries(req: Request) {
  const dateFrom = req.query.dateFrom?.toString();
  const dateTo = req.query.dateTo?.toString();
  const operatorId = req.query.operatorId?.toString();
  const paymentMethod = req.query.paymentMethod?.toString();
  return prisma.cashEntry.findMany({
    where: {
      ...companyWhere(req),
      deletedAt: null,
      ...(dateFrom || dateTo ? {
        createdAt: {
          ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00-03:00`) } : {}),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999-03:00`) } : {})
        }
      } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(paymentMethod ? { paymentMethod: paymentMethod as "CASH" | "PIX" | "CARD" } : {})
    },
    include: { session: { select: { operatorName: true, openedAt: true } } },
    orderBy: { createdAt: "desc" }
  });
}

export async function exportFinanceExcel(req: Request, res: Response) {
  const entries = await financialEntries(req);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Fluxo de Caixa");
  sheet.columns = [
    { header: "Data/Hora", key: "createdAt", width: 22 },
    { header: "Operador", key: "operator", width: 24 },
    { header: "Direcao", key: "direction", width: 12 },
    { header: "Categoria", key: "category", width: 24 },
    { header: "Pagamento", key: "payment", width: 20 },
    { header: "Motivo", key: "reason", width: 32 },
    { header: "Valor", key: "amount", width: 14 }
  ];
  entries.forEach((entry) => sheet.addRow({
    createdAt: entry.createdAt.toLocaleString("pt-BR"),
    operator: entry.operatorName ?? entry.session.operatorName ?? "-",
    direction: entry.direction === "IN" ? "Entrada" : "Saida",
    category: entry.category ?? entry.type,
    payment: entry.paymentDetail ?? entry.paymentMethod ?? "-",
    reason: entry.reason ?? entry.description ?? "-",
    amount: Number(entry.amount)
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("amount").numFmt = '"R$" #,##0.00';
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=fluxo-financeiro.xlsx");
  await workbook.xlsx.write(res);
  res.end();
}

export async function exportFinancePdf(req: Request, res: Response) {
  const entries = await financialEntries(req);
  const doc = new PDFDocument({ margin: 36, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=fluxo-financeiro.pdf");
  doc.pipe(res);
  doc.fontSize(18).text("Relatorio Financeiro", { align: "center" }).moveDown();
  let income = 0;
  let outcome = 0;
  entries.forEach((entry) => {
    const amount = Number(entry.amount);
    if (entry.direction === "IN") income += amount; else outcome += amount;
    doc.fontSize(9).text(
      `${entry.createdAt.toLocaleString("pt-BR")} | ${entry.operatorName ?? entry.session.operatorName ?? "-"} | ${entry.direction === "IN" ? "ENTRADA" : "SAIDA"} | ${entry.category ?? entry.type} | R$ ${amount.toFixed(2)}`
    );
  });
  doc.moveDown().fontSize(11).text(`Entradas: R$ ${income.toFixed(2)}`);
  doc.text(`Saidas: R$ ${outcome.toFixed(2)}`);
  doc.font("Helvetica-Bold").text(`Saldo: R$ ${(income - outcome).toFixed(2)}`);
  doc.end();
}
