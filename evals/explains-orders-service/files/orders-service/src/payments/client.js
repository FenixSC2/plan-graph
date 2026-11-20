import { config } from "../config.js";

export class PaymentDeclinedError extends Error {
  constructor(reason) { super(`Payment declined: ${reason}`); this.reason = reason; }
}

async function post(path, body) {
  const res = await fetch(`${config.paymentsUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.paymentsKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// Charges a card token. Declines throw PaymentDeclinedError; network errors propagate as-is.
export async function charge(amountCents, cardToken) {
  const { status, body } = await post("/charges", { amount: amountCents, source: cardToken });
  if (status === 402) throw new PaymentDeclinedError(body.reason ?? "declined");
  if (status >= 400) throw new Error(`Payments API error ${status}`);
  return body.id;
}

export async function refund(chargeId) {
  const { status } = await post("/refunds", { charge: chargeId });
  if (status >= 400) throw new Error(`Refund failed with ${status}`);
}
