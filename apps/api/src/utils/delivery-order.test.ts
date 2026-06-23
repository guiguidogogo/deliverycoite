import assert from "node:assert/strict";
import test from "node:test";
import { isOrderEligibleForDeliveryRoute } from "./delivery-order.js";

test("pedido de retirada nunca pode entrar em rota de motoboy", () => {
  assert.equal(isOrderEligibleForDeliveryRoute({
    fulfillmentType: "PICKUP",
    status: "PREPARING",
    activeRouteCount: 0
  }), false);
});

test("somente pedido de entrega em preparo e sem rota ativa fica disponivel", () => {
  assert.equal(isOrderEligibleForDeliveryRoute({
    fulfillmentType: "DELIVERY",
    status: "PREPARING",
    activeRouteCount: 0
  }), true);
  assert.equal(isOrderEligibleForDeliveryRoute({
    fulfillmentType: "DELIVERY",
    status: "PREPARING",
    activeRouteCount: 1
  }), false);
});
