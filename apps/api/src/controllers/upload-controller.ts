import type { Request, Response } from "express";

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: "Arquivo nao enviado" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  return res.status(201).json({ url: filePath });
}
