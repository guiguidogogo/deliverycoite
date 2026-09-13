import type { Request, Response } from "express";

export async function getFutureIntegrations(_req: Request, res: Response) {
  return res.json({
    ifood: "planned",
    mercadopago: "planned",
    automaticPix: "planned",
    notes: "Estrutura preparada para receber webhooks e conciliacao de pagamentos."
  });
}
