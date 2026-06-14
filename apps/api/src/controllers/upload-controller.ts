import type { Request, Response } from "express";

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: "Arquivo nao enviado" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0];
  const protocol = forwardedProtocol || req.protocol;
  const absoluteUrl = `${protocol}://${req.get("host")}${filePath}`;
  return res.status(201).json({ url: filePath, absoluteUrl });
}
