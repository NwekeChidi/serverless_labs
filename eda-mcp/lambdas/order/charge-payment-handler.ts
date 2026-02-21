import { Context } from "aws-lambda";

export const handler = async (event: any, _ctx: Context) => {
  const amount = Number(event.amount ?? 0);

  // ~80% success to demonstrate retries/catch
  const success = Math.random() < 0.8;
  await new Promise((resolve) => setTimeout(resolve, 200));

  if (!success) {
    // Keep orderId in state so catch step can still mark failure
    throw new Error("PAYMENT_TEMPORARY_FAILURE");
  }

  return {
    ...event,
    charged: true,
    paymentId: `pay_${Date.now()}`,
    amount,
    ts: new Date().toISOString(),
  };
};
