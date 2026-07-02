import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({ message: "Erro de validacao", issues: error.issues });
  }

  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return res.status(error.statusCode).json({
      message: "message" in error && typeof error.message === "string" ? error.message : "Erro na requisicao"
    });
  }

  console.error(error);
  return res.status(500).json({ message: "Erro interno no servidor" });
}
