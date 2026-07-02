import { Prisma } from "@prisma/client";

type StockItem = {
  productId: string;
  quantity: number;
  complements?: Array<{ complementId: string; quantity: number }>;
};

type Tx = Prisma.TransactionClient;

class StockError extends Error {
  statusCode = 409;
}

function addToMap(map: Map<string, number>, id: string, quantity: number) {
  map.set(id, (map.get(id) ?? 0) + quantity);
}

export async function validateAndDecrementStock(tx: Tx, companyId: string, items: StockItem[]) {
  const productQuantities = new Map<string, number>();
  const complementQuantities = new Map<string, number>();

  for (const item of items) {
    addToMap(productQuantities, item.productId, item.quantity);
    for (const complement of item.complements ?? []) {
      addToMap(complementQuantities, complement.complementId, complement.quantity * item.quantity);
    }
  }

  const [products, complements] = await Promise.all([
    productQuantities.size
      ? tx.product.findMany({
          where: { companyId, id: { in: Array.from(productQuantities.keys()) }, trackStock: true },
          select: { id: true, name: true, stockQuantity: true }
        })
      : Promise.resolve([]),
    complementQuantities.size
      ? tx.complement.findMany({
          where: { companyId, id: { in: Array.from(complementQuantities.keys()) }, trackStock: true },
          select: { id: true, name: true, stockQuantity: true }
        })
      : Promise.resolve([])
  ]);

  for (const product of products) {
    const required = productQuantities.get(product.id) ?? 0;
    if (Number(product.stockQuantity) < required) {
      throw new StockError(`Estoque insuficiente para ${product.name}. Disponivel: ${Number(product.stockQuantity).toString()}`);
    }
  }

  for (const complement of complements) {
    const required = complementQuantities.get(complement.id) ?? 0;
    if (Number(complement.stockQuantity) < required) {
      throw new StockError(`Estoque insuficiente para complemento ${complement.name}. Disponivel: ${Number(complement.stockQuantity).toString()}`);
    }
  }

  await Promise.all([
    ...products.map((product) => tx.product.update({
      where: { id: product.id },
      data: { stockQuantity: { decrement: new Prisma.Decimal(productQuantities.get(product.id) ?? 0) } }
    })),
    ...complements.map((complement) => tx.complement.update({
      where: { id: complement.id },
      data: { stockQuantity: { decrement: new Prisma.Decimal(complementQuantities.get(complement.id) ?? 0) } }
    }))
  ]);
}
