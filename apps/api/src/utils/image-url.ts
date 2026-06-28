import { z } from "zod";

export function isAllowedImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      new URL(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return trimmed.startsWith("/uploads/") || trimmed.startsWith("/api/marketplace/assets/");
}

export const optionalImageUrl = (message = "Informe uma URL de imagem valida") => z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().refine(isAllowedImageUrl, message).nullable().optional()
);
