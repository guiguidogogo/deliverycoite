export function isOrderEligibleForDeliveryRoute(order: {
  fulfillmentType: "DELIVERY" | "PICKUP";
  status: string;
  activeRouteCount?: number;
}) {
  return order.fulfillmentType === "DELIVERY"
    && order.status === "PREPARING"
    && (order.activeRouteCount ?? 0) === 0;
}
