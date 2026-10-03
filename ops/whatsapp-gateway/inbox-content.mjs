// Shared normalization for live events and historical message retrieval.
function baseInboxContent(data) {
  let message = data?.message ?? {};
  for (let i = 0; i < 5; i++) {
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension)
      return { messageType: "viewOnce", text: "Mensagem de visualização única: abra no WhatsApp." };
    const nested = message.ephemeralMessage?.message ?? message.documentWithCaptionMessage?.message;
    if (!nested) break;
    message = nested;
  }
  const location = message.locationMessage ?? message.liveLocationMessage;
  if (location) {
    const latitude = Number(location.degreesLatitude);
    const longitude = Number(location.degreesLongitude);
    return { messageType: "location", text: [location.name, location.address].filter(Boolean).join(" — ") || "Localização compartilhada", ...(Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? { latitude, longitude } : {}) };
  }
  for (const type of ["image", "audio", "video", "document", "sticker"]) {
    const media = message[`${type}Message`];
    if (media) return { messageType: type, text: String(media.caption ?? ""), filename: String(media.fileName ?? ""), mimeType: String(media.mimetype ?? ""), size: Number(media.fileLength ?? 0) };
  }
  return { messageType: "text", text: String(message.conversation ?? message.extendedTextMessage?.text ?? message.reactionMessage?.text ?? "") };
}

export function registerInboxContentRoute(router, { parse, z, getTenant, provider, HttpError }) {
  router.post("/whatsapp/inbox/content", async (req, res, next) => {
    try {
      const body = parse(z.object({ tenant_id: z.string().min(1), message_id: z.string().min(1).max(200), download: z.boolean().default(false) }).strict(), req.body);
      const tenant = await getTenant(req.hubApp.id, body.tenant_id, true);
      const instance = encodeURIComponent(tenant.whatsappInstance.evolutionInstanceName);
      const found = await provider.request(`/chat/findMessages/${instance}`, { method: "POST", body: JSON.stringify({ where: { key: { id: body.message_id } }, offset: 1, page: 1 }) });
      const record = found?.messages?.records?.find((item) => item.key?.id === body.message_id);
      if (!record) throw new HttpError(404, "Mensagem antiga não disponível no WhatsApp", "media_unavailable");
      const content = inboxContent(record);
      if (body.download && ["image", "audio", "video", "sticker", "document"].includes(content.messageType)) {
        if (content.size > 20 * 1024 * 1024) throw new HttpError(413, "Arquivo maior que 20 MB. Abra no WhatsApp.", "media_too_large");
        const media = await provider.request(`/chat/getBase64FromMediaMessage/${instance}`, { method: "POST", body: JSON.stringify({ message: { key: record.key, message: record.message }, convertToMp4: false }) });
        if (!media?.base64 || media.base64.length > 28 * 1024 * 1024) throw new HttpError(413, "Arquivo indisponível ou muito grande. Abra no WhatsApp.", "media_unavailable");
        content.base64 = media.base64;
        content.mimeType = media.mimetype || content.mimeType;
        content.filename = media.fileName || content.filename;
      }
      res.set("Cache-Control", "no-store").json(content);
    } catch (error) { next(error); }
  });
}

// Preserve the customer's WhatsApp reply context in both webhooks and content reads.
export function inboxContent(data) {
  const content = baseInboxContent(data);
  let message = data?.message ?? {};
  for (let i = 0; i < 5; i++) {
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension) return content;
    const nested = message.ephemeralMessage?.message ?? message.documentWithCaptionMessage?.message;
    if (!nested) break;
    message = nested;
  }
  const context = message.extendedTextMessage?.contextInfo
    ?? Object.values(message).find(value => value && typeof value === 'object' && value.contextInfo)?.contextInfo
    ?? message.messageContextInfo;
  if (!context?.stanzaId || !context?.quotedMessage) return content;
  const quoted = baseInboxContent({ message: context.quotedMessage });
  return { ...content, quotedMessage: {
    id: String(context.stanzaId).slice(0, 200),
    text: String(quoted.text || '').slice(0, 4000),
    messageType: String(quoted.messageType || 'text').slice(0, 40),
    author: String(context.participant || '').split('@')[0].slice(0, 100)
  } };
}
