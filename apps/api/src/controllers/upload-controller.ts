import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";

export async function uploadImage(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ message: "Arquivo nao enviado" });
  }

  const filePath = `/uploads/${req.file.filename}`;
  return res.status(201).json({ url: filePath, absoluteUrl: filePath });
}

export async function uploadPersistentImage(req: Request, res: Response) {
  if (!req.file?.buffer) {
    return res.status(400).json({ message: "Arquivo nao enviado" });
  }

  const image = await prisma.uploadedImage.create({
    data: {
      data: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname
    },
    select: { id: true }
  });
  const path = `/api/marketplace/assets/${image.id}`;

return res.status(201).json({
  url: path,
  absoluteUrl: path
});
}

export async function getPersistentImage(req: Request, res: Response) {
  const image = await prisma.uploadedImage.findUnique({
    where: { id: req.params.id }
  });
  if (!image) return res.status(404).json({ message: "Imagem nao encontrada" });

  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(Buffer.from(image.data));
}
