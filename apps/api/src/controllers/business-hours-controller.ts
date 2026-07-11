import type { Request, Response } from "express";
import { ClosedOrderPolicy } from "@prisma/client";
import { z } from "zod";
import {
  getCompanyOpenStatus,
  loadBusinessHoursState,
  saveBusinessHoursState,
  validateAndNormalizeBusinessHours
} from "../services/business-hours.js";
import { getCompanyId } from "../utils/tenant.js";

const periodSchema = z.object({
  openingTime: z.string(),
  closingTime: z.string()
});

const daySchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  isOpen: z.boolean(),
  periods: z.array(periodSchema).default([])
});

const payloadSchema = z.object({
  timezone: z.string().trim().optional(),
  closedOrderPolicy: z.nativeEnum(ClosedOrderPolicy).optional(),
  days: z.array(daySchema).min(7).max(7)
});

export async function getAdminBusinessHours(req: Request, res: Response) {
  const state = await loadBusinessHoursState(getCompanyId(req));
  return res.json(state);
}

export async function updateAdminBusinessHours(req: Request, res: Response) {
  const payload = payloadSchema.parse(req.body);
  const normalized = validateAndNormalizeBusinessHours(payload);
  const saved = await saveBusinessHoursState(getCompanyId(req), normalized);
  return res.json(saved);
}

export async function getOpenStatus(req: Request, res: Response) {
  const status = await getCompanyOpenStatus(getCompanyId(req));
  return res.json(status);
}
