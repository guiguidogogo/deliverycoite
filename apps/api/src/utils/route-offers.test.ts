import assert from "node:assert/strict";
import test from "node:test";
import { routePushDelays } from "../services/expo-push.js";
import { ROUTE_OFFER_SECONDS, routeOfferExpiresAt } from "./route-offers.js";

test("oferta de rota expira em 30 segundos", () => {
  const now = new Date("2026-06-21T20:00:00.000Z");
  assert.equal(ROUTE_OFFER_SECONDS, 30);
  assert.equal(
    routeOfferExpiresAt(now).toISOString(),
    "2026-06-21T20:00:30.000Z"
  );
});

test("push sonoro e repetido durante toda a oferta de 30 segundos", () => {
  assert.deepEqual(
    routePushDelays(30000, 4000),
    [4000, 8000, 12000, 16000, 20000, 24000, 28000]
  );
});
