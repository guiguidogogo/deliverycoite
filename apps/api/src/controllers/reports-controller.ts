import type { Request, Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { prisma } from "../utils/prisma.js";
import { formatOrderCode } from "../utils/order-code.js";

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
    where: getDateRange(req),
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
    where: getDateRange(req),
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
