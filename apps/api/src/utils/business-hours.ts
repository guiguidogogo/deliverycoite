import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horario invalido");

export const businessHourPeriodSchema = z.object({
  openingTime: timeSchema,
  closingTime: timeSchema
});

export const businessHourDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  periods: z.array(businessHourPeriodSchema).max(8).default([])
});

export const businessHoursSchema = z.object({
  timezone: z.string().trim().min(3).default("America/Bahia"),
  orderModeWhenClosed: z.enum(["BLOCK_WHEN_CLOSED", "ALLOW_WHEN_CLOSED"]).default("BLOCK_WHEN_CLOSED"),
  days: z.array(businessHourDaySchema).length(7)
}).superRefine((value, ctx) => {
  const seenDays = new Set<number>();
  for (const day of value.days) {
    if (seenDays.has(day.dayOfWeek)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: `Dia ${day.dayOfWeek} duplicado` });
    }
    seenDays.add(day.dayOfWeek);
    if (!day.isOpen) continue;
    if (!day.periods.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days", day.dayOfWeek, "periods"], message: "Informe pelo menos um horario" });
      continue;
    }
    const periods = [...day.periods].sort((a, b) => timeToMinutes(a.openingTime) - timeToMinutes(b.openingTime));
    for (let index = 0; index < periods.length; index += 1) {
      const current = periods[index];
      if (timeToMinutes(current.openingTime) >= timeToMinutes(current.closingTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", day.dayOfWeek, "periods", index],
          message: "Horario de abertura deve ser anterior ao fechamento"
        });
      }
      const previous = periods[index - 1];
      if (previous && timeToMinutes(current.openingTime) < timeToMinutes(previous.closingTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["days", day.dayOfWeek, "periods", index],
          message: `O periodo das ${current.openingTime} as ${current.closingTime} entra em conflito com ${previous.openingTime} as ${previous.closingTime}`
        });
      }
    }
  }
});

export type BusinessHours = z.infer<typeof businessHoursSchema>;

export function defaultBusinessHours(openTime = "18:00", closeTime = "23:59"): BusinessHours {
  return {
    timezone: "America/Bahia",
    orderModeWhenClosed: "BLOCK_WHEN_CLOSED",
    days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      isOpen: true,
      periods: [{ openingTime: openTime || "00:00", closingTime: closeTime || "23:59" }]
    }))
  };
}

export function normalizeBusinessHours(value: unknown, openTime?: string | null, closeTime?: string | null) {
  const parsed = businessHoursSchema.safeParse(value);
  if (parsed.success) {
    return {
      ...parsed.data,
      days: parsed.data.days
        .slice()
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((day) => ({
          ...day,
          periods: day.isOpen
            ? day.periods.slice().sort((a, b) => timeToMinutes(a.openingTime) - timeToMinutes(b.openingTime))
            : []
        }))
    };
  }
  return defaultBusinessHours(openTime ?? "00:00", closeTime ?? "23:59");
}

export function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dayOfWeek: map[weekday] ?? 0, minutes: hour * 60 + minute };
}

export function getStoreOpenStatus(params: {
  companyActive?: boolean;
  ordersPaused?: boolean;
  businessHours?: unknown;
  openTime?: string | null;
  closeTime?: string | null;
  now?: Date;
}) {
  if (params.companyActive === false || params.ordersPaused) {
    return { isOpen: false, message: "Loja fechada no momento", status: "closed" };
  }
  const schedule = normalizeBusinessHours(params.businessHours, params.openTime, params.closeTime);
  const now = zonedParts(params.now ?? new Date(), schedule.timezone);
  const today = schedule.days.find((day) => day.dayOfWeek === now.dayOfWeek);
  const current = today?.periods.find((period) => now.minutes >= timeToMinutes(period.openingTime) && now.minutes < timeToMinutes(period.closingTime));
  if (today?.isOpen && current) {
    return {
      isOpen: true,
      message: `Aberta agora, fecha as ${current.closingTime}`,
      status: "open",
      currentPeriod: current,
      businessHours: schedule
    };
  }

  for (let offset = 0; offset < 7; offset += 1) {
    const dayNumber = (now.dayOfWeek + offset) % 7;
    const day = schedule.days.find((item) => item.dayOfWeek === dayNumber);
    if (!day?.isOpen || !day.periods.length) continue;
    const next = day.periods.find((period) => offset > 0 || timeToMinutes(period.openingTime) > now.minutes);
    if (!next) continue;
    const dayText = offset === 0 ? "hoje" : offset === 1 ? "amanha" : ["domingo", "segunda-feira", "terca-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sabado"][dayNumber];
    return {
      isOpen: false,
      message: `Abre ${dayText} as ${next.openingTime}`,
      status: offset === 0 ? "closed_between_periods" : "closed_today",
      nextOpening: { dayOfWeek: dayNumber, openingTime: next.openingTime },
      businessHours: schedule
    };
  }

  return {
    isOpen: false,
    message: "Nao ha horarios de funcionamento configurados",
    status: "no_schedule_configured",
    businessHours: schedule
  };
}
