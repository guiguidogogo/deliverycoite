import type { Request, Response } from "express";
import { prisma } from "../utils/prisma.js";
import { getCompanyId } from "../utils/tenant.js";
import { env } from "../utils/env.js";

type Content = { messageType: string; text: string; latitude?: number; longitude?: number; mimeType?: string; filename?: string; base64?: string };
export async function getWhatsappContent(req: Request, res: Response) {
  const companyId = getCompanyId(req);
  const rows = await prisma.$queryRawUnsafe<Array<{ external_id: string | null }>>(
    `SELECT external_id FROM whatsapp_inbox_messages WHERE company_id = $1 AND id = $2 LIMIT 1`, companyId, req.params.id);
  if (!rows[0]?.external_id) return res.status(404).json({ message: "Conteúdo antigo indisponível. Peça ao cliente para reenviar." });
  try {
    const response = await fetch(`${env.hubWhatsappUrl}/api/v1/whatsapp/inbox/content`, { method: "POST", signal: AbortSignal.timeout(45000), headers: { "content-type": "application/json", "x-hub-api-key": env.hubWhatsappKey || "" }, body: JSON.stringify({ tenant_id: companyId, message_id: rows[0].external_id, download: req.query.download === "1" }) });
    if (!response.ok) throw new Error("Media unavailable");
    const content = await response.json() as Content;
    const validLocation = Number.isFinite(content.latitude) && Number.isFinite(content.longitude) && Math.abs(content.latitude!) <= 90 && Math.abs(content.longitude!) <= 180;
    await prisma.$executeRawUnsafe(`UPDATE whatsapp_inbox_messages SET message_type = $3, body = CASE WHEN $4 <> '' THEN $4 ELSE body END, latitude = COALESCE($5, latitude), longitude = COALESCE($6, longitude) WHERE company_id = $1 AND id = $2`, companyId, req.params.id, content.messageType, content.text || "", validLocation ? content.latitude : null, validLocation ? content.longitude : null);
    return res.set("Cache-Control", "private, no-store").json(content);
  } catch {
    return res.status(502).json({ message: "Não foi possível recuperar este conteúdo. Ele pode ter expirado no WhatsApp. Tente novamente ou peça o reenvio." });
  }
}
