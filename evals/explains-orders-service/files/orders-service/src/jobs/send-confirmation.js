import { db } from "../db.js";
import { send } from "../mailer.js";
import { formatCents } from "../util/money.js";

export async function sendConfirmation({ orderId }) {
  const order = db.orders.get(orderId);
  if (!order) return; // cancelled and purged before the job ran
  await send(order.email, `Order ${order.id} confirmed`, `Thanks! We charged ${formatCents(order.totalCents)}.`);
  db.orders.update(order.id, { confirmationSentAt: new Date().toISOString() });
}
