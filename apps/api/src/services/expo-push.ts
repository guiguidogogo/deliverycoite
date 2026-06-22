import { prisma } from "../utils/prisma.js";
import { ROUTE_OFFER_SECONDS } from "../utils/route-offers.js";

type PushMessage = {
  driverId: string;
  companyId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  categoryId?: string;
};

export const ROUTE_PUSH_INTERVAL_MS = 4000;

export function routePushDelays(
  durationMs = ROUTE_OFFER_SECONDS * 1000,
  intervalMs = ROUTE_PUSH_INTERVAL_MS
) {
  const delays: number[] = [];
  for (let delay = intervalMs; delay < durationMs; delay += intervalMs) {
    delays.push(delay);
  }
  return delays;
}

export async function sendDriverPush(message: PushMessage) {
  const devices = await prisma.driverDeviceToken.findMany({
    where: {
      driverId: message.driverId,
      companyId: message.companyId,
      active: true
    },
    select: { id: true, expoToken: true }
  });
  if (!devices.length) return { sent: 0, errors: [] as string[] };

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(devices.map((device) => ({
      to: device.expoToken,
      sound: "ringtone.wav",
      priority: "high",
      channelId: "delivery-routes-ringing",
      title: message.title,
      body: message.body,
      data: message.data ?? {}
      ,
      categoryId: message.categoryId
    })))
  });

  if (!response.ok) {
    return { sent: 0, errors: [`Expo Push respondeu HTTP ${response.status}`] };
  }
  const payload = await response.json() as {
    data?: Array<{
      status: "ok" | "error";
      id?: string;
      message?: string;
      details?: { error?: string };
    }>;
  };
  const results = payload.data ?? [];
  const invalidTokens = devices.filter((_, index) =>
    results[index]?.status === "error"
    && results[index]?.details?.error === "DeviceNotRegistered"
  );
  if (invalidTokens.length) {
    await prisma.driverDeviceToken.updateMany({
      where: { id: { in: invalidTokens.map((device) => device.id) } },
      data: { active: false }
    });
  }
  const tickets = devices.flatMap((device, index) => {
    const ticket = results[index];
    return ticket?.status === "ok" && ticket.id
      ? [{ deviceId: device.id, ticketId: ticket.id }]
      : [];
  });
  if (tickets.length) {
    const receiptTimer = setTimeout(async () => {
      const receiptResponse = await fetch(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ ids: tickets.map((ticket) => ticket.ticketId) })
        }
      ).catch(() => null);
      if (!receiptResponse?.ok) return;
      const receipts = await receiptResponse.json() as {
        data?: Record<string, {
          status: "ok" | "error";
          details?: { error?: string };
        }>;
      };
      const invalidDeviceIds = tickets
        .filter(({ ticketId }) =>
          receipts.data?.[ticketId]?.status === "error"
          && receipts.data[ticketId]?.details?.error === "DeviceNotRegistered"
        )
        .map(({ deviceId }) => deviceId);
      if (invalidDeviceIds.length) {
        await prisma.driverDeviceToken.updateMany({
          where: { id: { in: invalidDeviceIds } },
          data: { active: false }
        });
      }
    }, 10000);
    receiptTimer.unref();
  }
  return {
    sent: results.filter((item) => item.status === "ok").length,
    errors: results.filter((item) => item.status === "error").map((item) => {
      const errorMessage = item.message ?? "Falha no push";
      return /FCM server key|Firebase/i.test(errorMessage)
        ? "Credencial FCM V1 ainda nao configurada no projeto EAS"
        : errorMessage;
    })
  };
}

export function repeatDriverRouteOfferPush(
  routeId: string,
  message: PushMessage,
  expiresAt: Date
) {
  const delays = routePushDelays(
    Math.max(0, expiresAt.getTime() - Date.now())
  );

  for (const delay of delays) {
    const timer = setTimeout(async () => {
      const route = await prisma.deliveryRoute.findFirst({
        where: {
          id: routeId,
          driverId: message.driverId,
          companyId: message.companyId,
          status: "CREATED",
          offerExpiresAt: { gt: new Date() }
        },
        select: { offerExpiresAt: true }
      }).catch(() => null);

      if (!route) return;
      const seconds = Math.max(
        1,
        Math.ceil((route.offerExpiresAt!.getTime() - Date.now()) / 1000)
      );
      await sendDriverPush({
        ...message,
        body: `${message.body} Responda em ${seconds} segundos.`
      }).catch(() => undefined);
    }, delay);
    timer.unref();
  }

  const expirationTimer = setTimeout(async () => {
    await prisma.deliveryRoute.updateMany({
      where: {
        id: routeId,
        driverId: message.driverId,
        companyId: message.companyId,
        status: "CREATED",
        offerExpiresAt: { lte: new Date() }
      },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        declinedAt: new Date()
      }
    }).catch(() => undefined);
  }, Math.max(0, expiresAt.getTime() - Date.now()) + 250);
  expirationTimer.unref();
}
