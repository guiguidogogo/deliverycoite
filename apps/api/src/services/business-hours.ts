import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezonePlugin from "dayjs/plugin/timezone.js";
import { ClosedOrderPolicy, Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

export const DEFAULT_TIMEZONE = "America/Bahia";

export type BusinessHourPeriodInput = {
  openingTime: string;
  closingTime: string;
};

export type BusinessHourDayInput = {
  dayOfWeek: number;
  isOpen: boolean;
  periods: BusinessHourPeriodInput[];
};

export type BusinessHoursPayload = {
  timezone?: string;
  closedOrderPolicy?: ClosedOrderPolicy;
  days: BusinessHourDayInput[];
};

export type NormalizedBusinessHourDay = {
  dayOfWeek: number;
  isOpen: boolean;
  periods: BusinessHourPeriodInput[];
};

export type BusinessHoursState = {
  timezone: string;
  closedOrderPolicy: ClosedOrderPolicy;
  days: NormalizedBusinessHourDay[];
};

export type OpenStatus = {
  isOpen: boolean;
  status:
    | "open"
    | "closed_today"
    | "closed_between_periods"
    | "closed_before_opening"
    | "closed_after_hours"
    | "no_schedule_configured"
    | "orders_paused"
    | "company_inactive";
  message: string;
  nextOpening: string | null;
  closesAt: string | null;
  currentPeriod: BusinessHourPeriodInput | null;
  timezone: string;
};

const DAY_NAMES = [
  "domingo",
  "segunda-feira",
  "terca-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sabado"
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function assertValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value }).format(new Date());
  } catch {
    throw new Error(`Fuso horario invalido: ${value}`);
  }
}

export function validateAndNormalizeBusinessHours(payload: BusinessHoursPayload): BusinessHoursState {
  const timezone = payload.timezone?.trim() || DEFAULT_TIMEZONE;
  assertValidTimezone(timezone);

  const byDay = new Map<number, BusinessHourDayInput>();
  for (const day of payload.days ?? []) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new Error("Dia da semana invalido. Use 0 para domingo ate 6 para sabado.");
    }
    if (byDay.has(day.dayOfWeek)) {
      throw new Error(`Dia duplicado: ${DAY_NAMES[day.dayOfWeek]}`);
    }
    byDay.set(day.dayOfWeek, day);
  }

  const days: NormalizedBusinessHourDay[] = [];
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const input = byDay.get(dayOfWeek) ?? { dayOfWeek, isOpen: false, periods: [] };
    const periods = input.isOpen ? [...(input.periods ?? [])] : [];

    const normalizedPeriods = periods.map((period, index) => {
      const openingTime = period.openingTime?.trim();
      const closingTime = period.closingTime?.trim();
      if (!openingTime || !closingTime) {
        throw new Error(`${DAY_NAMES[dayOfWeek]}: periodo ${index + 1} esta incompleto.`);
      }
      if (!TIME_PATTERN.test(openingTime) || !TIME_PATTERN.test(closingTime)) {
        throw new Error(`${DAY_NAMES[dayOfWeek]}: use horarios validos no formato 24h, como 08:00.`);
      }
      if (minutes(openingTime) >= minutes(closingTime)) {
        throw new Error(`${DAY_NAMES[dayOfWeek]}: o horario de abertura deve ser anterior ao fechamento.`);
      }
      return { openingTime, closingTime };
    }).sort((left, right) => minutes(left.openingTime) - minutes(right.openingTime));

    for (let index = 1; index < normalizedPeriods.length; index += 1) {
      const previous = normalizedPeriods[index - 1];
      const current = normalizedPeriods[index];
      if (
        previous.openingTime === current.openingTime &&
        previous.closingTime === current.closingTime
      ) {
        throw new Error(`${DAY_NAMES[dayOfWeek]}: periodo duplicado ${current.openingTime} as ${current.closingTime}.`);
      }
      if (minutes(current.openingTime) < minutes(previous.closingTime)) {
        throw new Error(
          `${DAY_NAMES[dayOfWeek]}: o periodo das ${current.openingTime} as ${current.closingTime} entra em conflito com o periodo das ${previous.openingTime} as ${previous.closingTime}.`
        );
      }
    }

    if (input.isOpen && normalizedPeriods.length === 0) {
      throw new Error(`${DAY_NAMES[dayOfWeek]}: informe ao menos um periodo ou marque o dia como fechado.`);
    }

    days.push({
      dayOfWeek,
      isOpen: Boolean(input.isOpen),
      periods: input.isOpen ? normalizedPeriods : []
    });
  }

  return {
    timezone,
    closedOrderPolicy: payload.closedOrderPolicy ?? ClosedOrderPolicy.BLOCK_WHEN_CLOSED,
    days
  };
}

export function legacyWeekFromSettings(openTime?: string | null, closeTime?: string | null): NormalizedBusinessHourDay[] {
  const safeOpen = TIME_PATTERN.test(openTime ?? "") ? openTime! : "00:00";
  const safeClose = TIME_PATTERN.test(closeTime ?? "") && closeTime !== safeOpen ? closeTime! : "23:59";
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    isOpen: true,
    periods: [{ openingTime: safeOpen, closingTime: safeClose }]
  }));
}

function dayLabel(dayOfWeek: number, offset: number) {
  if (offset === 0) return "hoje";
  if (offset === 1) return "amanha";
  return `na ${DAY_NAMES[dayOfWeek]}`;
}

function buildLocalDateTime(base: dayjs.Dayjs, dayOffset: number, time: string, timezone: string) {
  const localDate = base.add(dayOffset, "day").format("YYYY-MM-DD");
  return dayjs.tz(`${localDate}T${time}:00`, timezone);
}

export function evaluateBusinessHours(
  state: BusinessHoursState,
  options?: {
    now?: Date;
    companyIsActive?: boolean;
    ordersPaused?: boolean;
  }
): OpenStatus {
  const timezone = state.timezone || DEFAULT_TIMEZONE;
  const localNow = dayjs(options?.now ?? new Date()).tz(timezone);
  const currentDay = localNow.day();
  const currentMinutes = localNow.hour() * 60 + localNow.minute();

  if (options?.companyIsActive === false) {
    return {
      isOpen: false,
      status: "company_inactive",
      message: "Empresa inativa",
      nextOpening: null,
      closesAt: null,
      currentPeriod: null,
      timezone
    };
  }

  if (options?.ordersPaused) {
    return {
      isOpen: false,
      status: "orders_paused",
      message: "Pedidos pausados temporariamente",
      nextOpening: null,
      closesAt: null,
      currentPeriod: null,
      timezone
    };
  }

  if (!state.days.length) {
    return {
      isOpen: false,
      status: "no_schedule_configured",
      message: "Horario de funcionamento nao configurado",
      nextOpening: null,
      closesAt: null,
      currentPeriod: null,
      timezone
    };
  }

  const today = state.days.find((day) => day.dayOfWeek === currentDay);
  if (today?.isOpen) {
    const current = today.periods.find((period) =>
      currentMinutes >= minutes(period.openingTime) && currentMinutes < minutes(period.closingTime)
    );
    if (current) {
      return {
        isOpen: true,
        status: "open",
        message: "Aberta agora",
        nextOpening: null,
        closesAt: buildLocalDateTime(localNow, 0, current.closingTime, timezone).format(),
        currentPeriod: current,
        timezone
      };
    }
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const dayOfWeek = (currentDay + offset) % 7;
    const day = state.days.find((candidate) => candidate.dayOfWeek === dayOfWeek);
    if (!day?.isOpen) continue;
    const nextPeriod = day.periods.find((period) => offset > 0 || minutes(period.openingTime) > currentMinutes);
    if (!nextPeriod) continue;
    const nextOpening = buildLocalDateTime(localNow, offset, nextPeriod.openingTime, timezone);
    const status =
      offset > 0
        ? "closed_after_hours"
        : today?.periods.length && currentMinutes > minutes(today.periods[0].openingTime)
          ? "closed_between_periods"
          : "closed_before_opening";
    return {
      isOpen: false,
      status,
      message: `Abre ${dayLabel(dayOfWeek, offset)} as ${nextPeriod.openingTime}`,
      nextOpening: nextOpening.format(),
      closesAt: null,
      currentPeriod: null,
      timezone
    };
  }

  return {
    isOpen: false,
    status: today?.isOpen ? "closed_after_hours" : "closed_today",
    message: "Nao ha horarios disponiveis no momento",
    nextOpening: null,
    closesAt: null,
    currentPeriod: null,
    timezone
  };
}

export async function loadBusinessHoursState(companyId: string): Promise<BusinessHoursState> {
  const [settings, days] = await Promise.all([
    prisma.setting.findUnique({
      where: { companyId },
      select: {
        openTime: true,
        closeTime: true,
        timezone: true,
        closedOrderPolicy: true
      }
    }),
    prisma.companyBusinessHour.findMany({
      where: { companyId },
      include: { periods: { orderBy: { openingTime: "asc" } } },
      orderBy: { dayOfWeek: "asc" }
    })
  ]);

  return {
    timezone: settings?.timezone ?? DEFAULT_TIMEZONE,
    closedOrderPolicy: settings?.closedOrderPolicy ?? ClosedOrderPolicy.BLOCK_WHEN_CLOSED,
    days: days.length
      ? days.map((day) => ({
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen,
          periods: day.periods.map((period) => ({
            openingTime: period.openingTime,
            closingTime: period.closingTime
          }))
        }))
      : legacyWeekFromSettings(settings?.openTime, settings?.closeTime)
  };
}

export async function saveBusinessHoursState(companyId: string, payload: BusinessHoursPayload) {
  const normalized = validateAndNormalizeBusinessHours(payload);

  return prisma.$transaction(async (tx) => {
    await tx.setting.update({
      where: { companyId },
      data: {
        timezone: normalized.timezone,
        closedOrderPolicy: normalized.closedOrderPolicy
      }
    });

    for (const day of normalized.days) {
      const savedDay = await tx.companyBusinessHour.upsert({
        where: { companyId_dayOfWeek: { companyId, dayOfWeek: day.dayOfWeek } },
        create: {
          companyId,
          dayOfWeek: day.dayOfWeek,
          isOpen: day.isOpen
        },
        update: { isOpen: day.isOpen }
      });

      await tx.companyBusinessHourPeriod.deleteMany({
        where: { businessHourId: savedDay.id }
      });

      if (day.isOpen && day.periods.length) {
        await tx.companyBusinessHourPeriod.createMany({
          data: day.periods.map((period) => ({
            businessHourId: savedDay.id,
            openingTime: period.openingTime,
            closingTime: period.closingTime
          }))
        });
      }
    }

    return {
      timezone: normalized.timezone,
      closedOrderPolicy: normalized.closedOrderPolicy,
      days: normalized.days
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted
  });
}

export async function getCompanyOpenStatus(companyId: string, now?: Date) {
  const [company, settings, state] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { active: true, isOpen: true }
    }),
    prisma.setting.findUnique({
      where: { companyId },
      select: { ordersPaused: true }
    }),
    loadBusinessHoursState(companyId)
  ]);

  return evaluateBusinessHours(state, {
    now,
    companyIsActive: Boolean(company?.active && company.isOpen),
    ordersPaused: Boolean(settings?.ordersPaused)
  });
}
