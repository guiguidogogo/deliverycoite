export function formatOrderCode(orderNumber: number) {
  return String(orderNumber).padStart(5, "0");
}
