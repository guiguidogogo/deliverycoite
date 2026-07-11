import assert from "node:assert/strict";
import { ClosedOrderPolicy } from "@prisma/client";
import {
  DEFAULT_TIMEZONE,
  evaluateBusinessHours,
  legacyWeekFromSettings,
  validateAndNormalizeBusinessHours,
  type BusinessHoursState
} from "./business-hours.js";

function state(days: BusinessHoursState["days"]): BusinessHoursState {
  return {
    timezone: DEFAULT_TIMEZONE,
    closedOrderPolicy: ClosedOrderPolicy.BLOCK_WHEN_CLOSED,
    days
  };
}

function weekWith(dayOfWeek: number, periods: Array<{ openingTime: string; closingTime: string }>) {
  return Array.from({ length: 7 }, (_, index) => ({
    dayOfWeek: index,
    isOpen: index === dayOfWeek,
    periods: index === dayOfWeek ? periods : []
  }));
}

function bahiaDate(isoLocal: string) {
  return new Date(`${isoLocal}-03:00`);
}

const mondayTwoPeriods = state(weekWith(1, [
  { openingTime: "08:00", closingTime: "12:00" },
  { openingTime: "13:30", closingTime: "22:00" }
]));

assert.equal(
  evaluateBusinessHours(mondayTwoPeriods, { now: bahiaDate("2026-07-13T08:00") }).status,
  "open",
  "abre no inicio do primeiro periodo"
);

assert.equal(
  evaluateBusinessHours(mondayTwoPeriods, { now: bahiaDate("2026-07-13T12:30") }).status,
  "closed_between_periods",
  "fecha no intervalo entre periodos"
);

assert.equal(
  evaluateBusinessHours(mondayTwoPeriods, { now: bahiaDate("2026-07-13T13:30") }).isOpen,
  true,
  "reabre no segundo periodo"
);

assert.equal(
  evaluateBusinessHours(mondayTwoPeriods, { now: bahiaDate("2026-07-13T22:00") }).isOpen,
  false,
  "fecha exatamente no horario final"
);

assert.equal(
  evaluateBusinessHours(mondayTwoPeriods, { now: bahiaDate("2026-07-12T10:00") }).message,
  "Abre amanha as 08:00",
  "calcula proxima abertura no dia seguinte"
);

assert.equal(
  evaluateBusinessHours(state([]), { now: bahiaDate("2026-07-13T10:00") }).status,
  "no_schedule_configured",
  "trata loja sem configuracao"
);

assert.throws(
  () => validateAndNormalizeBusinessHours({
    timezone: DEFAULT_TIMEZONE,
    days: weekWith(1, [
      { openingTime: "08:00", closingTime: "12:00" },
      { openingTime: "11:00", closingTime: "14:00" }
    ])
  }),
  /entra em conflito/,
  "bloqueia sobreposicao"
);

assert.throws(
  () => validateAndNormalizeBusinessHours({
    timezone: DEFAULT_TIMEZONE,
    days: weekWith(1, [
      { openingTime: "18:00", closingTime: "08:00" }
    ])
  }),
  /anterior ao fechamento/,
  "bloqueia fechamento anterior a abertura"
);

assert.throws(
  () => validateAndNormalizeBusinessHours({
    timezone: DEFAULT_TIMEZONE,
    days: weekWith(1, [
      { openingTime: "25:00", closingTime: "26:00" }
    ])
  }),
  /formato 24h/,
  "bloqueia horario invalido"
);

assert.equal(
  validateAndNormalizeBusinessHours({
    timezone: DEFAULT_TIMEZONE,
    days: weekWith(1, [
      { openingTime: "12:00", closingTime: "18:00" },
      { openingTime: "08:00", closingTime: "12:00" }
    ])
  }).days.find((day) => day.dayOfWeek === 1)?.periods[0]?.openingTime,
  "08:00",
  "ordena periodos pelo horario de abertura"
);

assert.deepEqual(
  legacyWeekFromSettings("18:00", "23:59")[0],
  { dayOfWeek: 0, isOpen: true, periods: [{ openingTime: "18:00", closingTime: "23:59" }] },
  "migra horario antigo para estrutura semanal"
);

console.log("business-hours tests passed");
