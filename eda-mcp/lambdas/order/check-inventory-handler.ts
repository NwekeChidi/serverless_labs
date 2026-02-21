import { Context } from "aws-lambda";

const CATALOG: Record<string, number> = { "sku-001": 100, "sku-002": 0, "sku-003": 7 };

export const handler = async (event: any, _ctx: Context) => {
  const sku = String(event.sku ?? "sku-001");
  const qty = Number(event.qty ?? 1);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const stock = CATALOG[sku] ?? 0;
  const inStock = stock >= qty;

  return {
    ...event, // keep orderId
    sku,
    requested: qty,
    inStock,
    ts: new Date().toISOString(),
  };
};
