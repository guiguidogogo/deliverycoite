import assert from "node:assert/strict";
import test from "node:test";
import { ROUTE_OFFER_SECONDS, routeOfferExpiresAt } from "./route-offers.js";

test("oferta de rota expira em 30 segundos", () => {
  const now = new Date("2026-06-21T20:00:00.000Z");
  assert.equal(ROUTE_OFFER_SECONDS, 30);
  assert.equal(
    routeOfferExpiresAt(now).toISOString(),
    "2026-06-21T20:00:30.000Z"
  );
});
