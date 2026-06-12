type PrintableItem = {
  name: string;
  quantity: number;
};

type PrintableOrder = {
  id: string;
  customer: string;
  items: PrintableItem[];
};

export async function printOrder(order: PrintableOrder) {
  // Integracao base para impressora termica local.
  // Em producao, conecte aqui ao driver do equipamento (ESC/POS ou spool do SO).
  console.log("[THERMAL PRINT] Pedido", order.id, order.customer, order.items);
}
