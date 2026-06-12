import type { Request, Response } from "express";
import { listSystemPrinters } from "../services/thermal-printer.js";

export async function listPrinters(_req: Request, res: Response) {
  try {
    const printers = await listSystemPrinters();
    return res.json(printers);
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Falha ao listar impressoras"
    });
  }
}
