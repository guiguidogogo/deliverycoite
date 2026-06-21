import { prisma } from "../utils/prisma.js";

type PushMessage = {
  driverId: string;
  companyId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
};

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
      sound: "default",
      priority: "high",
      channelId: "delivery-routes",
      title: message.title,
      body: message.body,
      data: message.data ?? {}
    })))
  });

  if (!response.ok) {
    return { sent: 0, errors: [`Expo Push respondeu HTTP ${response.status}`] };
  }
  const payload = await response.json() as {
    data?: Array<{ status: "ok" | "error"; message?: string; details?: { error?: string } }>;
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
  return {
    sent: results.filter((item) => item.status === "ok").length,
    errors: results.filter((item) => item.status === "error").map((item) => item.message ?? "Falha no push")
  };
}
