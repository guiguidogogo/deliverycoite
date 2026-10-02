import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { env } from "../utils/env.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } }).single("file");
export function receiveCampaignMedia(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error: unknown) => {
    if (error) return res.status(400).json({ message: "Não foi possível receber o arquivo. Envie apenas um arquivo de até 15 MB." });
    next();
  });
}
export async function uploadCampaignMedia(req: Request, res: Response) {
  const file = req.file;
  if (!file?.buffer.length) return res.status(400).json({ message: "Selecione um arquivo." });
  const b = file.buffer;
  const signature = b.subarray(0, 12).toString("hex");
  let mime = "";
  let extension = "";
  if (signature.startsWith("ffd8ff")) { mime = "image/jpeg"; extension = "jpg"; }
  else if (signature.startsWith("89504e470d0a1a0a")) { mime = "image/png"; extension = "png"; }
  else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") { mime = "image/webp"; extension = "webp"; }
  else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WAVE") { mime = "audio/wav"; extension = "wav"; }
  else if (b.toString("ascii", 0, 4) === "OggS") { mime = "audio/ogg"; extension = "ogg"; }
  else if (b.toString("ascii", 0, 3) === "ID3" || (b[0] === 255 && (b[1] & 224) === 224)) { mime = "audio/mpeg"; extension = "mp3"; }
  else if (b.toString("ascii", 4, 8) === "ftyp") { mime = file.mimetype.startsWith("audio/") ? "audio/mp4" : "video/mp4"; extension = mime.startsWith("audio") ? "m4a" : "mp4"; }
  if (!mime) return res.status(400).json({ message: "Formato não suportado. Use JPG, PNG, WebP, MP3, WAV, OGG, M4A ou MP4." });
  const companyId = getCompanyId(req);
  const filename = `${file.originalname.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "anexo"}.${extension}`;
  const asset = await prisma.uploadedImage.create({ data: { data: b, mimeType: mime, originalName: `campaign:${companyId}:${filename}` }, select: { id: true } });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { subdomain: true } });
  return res.status(201).json({ id: asset.id, filename, mimeType: mime, size: b.length, url: `https://${company.subdomain}.${env.rootDomain}/api/marketplace/assets/${asset.id}` });
}
