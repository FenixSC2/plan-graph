import * as service from "../lib/invoiceService.js";
import { formatInvoice } from "../lib/format.js";

// POST /invoices/:id/pay
export function payInvoice(id) {
  const inv = service.getById(Number(id));
  if (!inv) return { status: 404, body: { message: "Invoice not found" } };
  if (inv.status === "paid") return { status: 409, body: { message: "Invoice already paid" } };
  const updated = service.update(inv.id, { status: "paid", paidAt: new Date().toISOString() });
  return { status: 200, body: formatInvoice(updated) };
}
