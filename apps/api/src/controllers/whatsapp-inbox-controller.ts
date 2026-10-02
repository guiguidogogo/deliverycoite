import type { Request, Response } from "express";
import { sendHubWhatsappText } from "../services/hub-whatsapp.js";
import { env } from "../utils/env.js";

type Label = { id: string; name: string };
type QuickReply = { id: string; name: string; message: string; media?: unknown[] };
const labels: Label[] = [];
const quickReplies: QuickReply[] = [];

export async function listInboxConversations(_req: Request, res: Response) { return res.json([]); }
export async function listInboxMessages(_req: Request, res: Response) { return res.json([]); }
export async function listInboxLabels(_req: Request, res: Response) { return res.json(labels); }
export async function createInboxLabel(req: Request, res: Response) { const item = { id: crypto.randomUUID(), name: String(req.body?.name ?? "").trim() }; if (!item.name) return res.status(400).json({ message: "Informe o nome" }); labels.push(item); return res.status(201).json(item); }
export async function listInboxQuickReplies(_req: Request, res: Response) { return res.json(quickReplies); }
export async function createInboxQuickReply(req: Request, res: Response) { const item = { id: crypto.randomUUID(), name: String(req.body?.name ?? "").trim(), message: String(req.body?.message ?? ""), media: req.body?.media ?? [] }; quickReplies.push(item); return res.status(201).json(item); }
export async function updateInboxQuickReply(req: Request, res: Response) { const item = quickReplies.find((x) => x.id === req.params.id); if (!item) return res.status(404).json({ message: "Atalho não encontrado" }); Object.assign(item, req.body); return res.json(item); }
export async function deleteInboxQuickReply(req: Request, res: Response) { const index = quickReplies.findIndex((x) => x.id === req.params.id); if (index >= 0) quickReplies.splice(index, 1); return res.status(204).send(); }
export async function sendInboxMessage(req: Request, res: Response) { const phone = String(req.body?.phone ?? "").replace(/\D/g, ""); const message = String(req.body?.message ?? "").trim(); if (!phone || !message) return res.status(400).json({ message: "Informe telefone e mensagem" }); const job = await sendHubWhatsappText(env.whatsappAiTenantId, phone, message); return res.status(202).json(job); }
export async function createInboxContact(_req: Request, res: Response) { return res.status(501).json({ message: "Cadastro de contato ainda não disponível" }); }
export async function listInboxAddresses(_req: Request, res: Response) { return res.json([]); }
