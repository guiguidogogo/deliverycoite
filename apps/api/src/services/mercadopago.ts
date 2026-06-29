const MP_API = "https://api.mercadopago.com";

export type MercadoPagoPreferenceResponse = {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
};

export type MercadoPagoPaymentResponse = {
  id: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  transaction_amount?: number;
  metadata?: { order_id?: string; company_id?: string };
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

export type MercadoPagoPaymentSearchResponse = {
  results?: MercadoPagoPaymentResponse[];
  paging?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
};

export type MercadoPagoRefundResponse = {
  id: number | string;
  payment_id?: number | string;
  status?: string;
  amount?: number;
};

async function mpFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message ?? payload?.error ?? "Falha na comunicacao com Mercado Pago";
    throw new Error(message);
  }
  return payload as T;
}

export async function createMercadoPagoPreference(params: {
  accessToken: string;
  orderId: string;
  companyId: string;
  orderNumber: number;
  description: string;
  amount: number;
  payer?: { name?: string; email?: string | null; phone?: string | null };
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
}) {
  return mpFetch<MercadoPagoPreferenceResponse>("/checkout/preferences", params.accessToken, {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          id: params.orderId,
          title: `Pedido #${String(params.orderNumber).padStart(5, "0")}`,
          description: params.description,
          quantity: 1,
          currency_id: "BRL",
          unit_price: Number(params.amount.toFixed(2))
        }
      ],
      payer: {
        name: params.payer?.name,
        email: params.payer?.email || undefined,
        phone: params.payer?.phone ? { number: params.payer.phone.replace(/\D/g, "") } : undefined
      },
      external_reference: params.orderId,
      metadata: {
        order_id: params.orderId,
        company_id: params.companyId
      },
      notification_url: params.notificationUrl,
      back_urls: {
        success: params.successUrl,
        failure: params.failureUrl,
        pending: params.pendingUrl
      },
      statement_descriptor: "HUBREGIONAL"
    })
  });
}

export async function getMercadoPagoPayment(accessToken: string, paymentId: string) {
  return mpFetch<MercadoPagoPaymentResponse>(`/v1/payments/${encodeURIComponent(paymentId)}`, accessToken);
}

export async function searchMercadoPagoPayments(accessToken: string, params: {
  externalReference?: string | null;
}) {
  const search = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
    limit: "10"
  });
  if (params.externalReference) search.set("external_reference", params.externalReference);
  return mpFetch<MercadoPagoPaymentSearchResponse>(`/v1/payments/search?${search.toString()}`, accessToken);
}

export async function refundMercadoPagoPayment(accessToken: string, paymentId: string) {
  return mpFetch<MercadoPagoRefundResponse>(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, accessToken, {
    method: "POST",
    headers: {
      "X-Idempotency-Key": `refund-${paymentId}-${Date.now()}`
    },
    body: JSON.stringify({})
  });
}

export async function createMercadoPagoPixPayment(params: {
  accessToken: string;
  orderId: string;
  companyId: string;
  orderNumber: number;
  description: string;
  amount: number;
  payer: { name: string; email?: string | null; phone?: string | null };
  notificationUrl: string;
}) {
  return mpFetch<MercadoPagoPaymentResponse>("/v1/payments", params.accessToken, {
    method: "POST",
    headers: {
      "X-Idempotency-Key": `order-pix-${params.orderId}`
    },
    body: JSON.stringify({
      transaction_amount: Number(params.amount.toFixed(2)),
      description: params.description,
      payment_method_id: "pix",
      external_reference: params.orderId,
      notification_url: params.notificationUrl,
      metadata: {
        order_id: params.orderId,
        company_id: params.companyId,
        order_number: params.orderNumber
      },
      payer: {
        email: params.payer.email || `cliente-${params.orderId}@hubregional.com.br`,
        first_name: params.payer.name,
        phone: params.payer.phone ? { number: params.payer.phone.replace(/\D/g, "") } : undefined
      }
    })
  });
}
