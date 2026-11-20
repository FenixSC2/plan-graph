import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import * as inventory from "../inventory/index.js";
import * as payments from "../payments/client.js";
import { enqueue } from "../queue.js";
import { toCents } from "../util/money.js";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export async function placeOrder({ email, cardToken, items }) {
  inventory.reserve(items);
  const totalCents = items.reduce((sum, it) => sum + toCents(it.price) * it.qty, 0);
  const chargeId = await payments.charge(totalCents, cardToken);
  const order = db.orders.insert({
    id: randomUUID(), email, items, totalCents, chargeId,
    status: "paid", createdAt: new Date().toISOString(),
  });
  enqueue("order-confirmation", { orderId: order.id });
  return order;
}

export function getOrder(id) {
  const order = db.orders.get(id);
  if (!order) throw new NotFoundError(id);
  return order;
}

export async function cancelOrder(id) {
  const order = getOrder(id);
  if (order.status === "cancelled") throw new ConflictError("already cancelled");
  if (order.confirmationSentAt && Date.now() - Date.parse(order.createdAt) > 24 * 3600e3) {
    throw new ConflictError("orders can only be cancelled within 24 hours");
  }
  await payments.refund(order.chargeId);
  inventory.release(order.items);
  return db.orders.update(id, { status: "cancelled" });
}
