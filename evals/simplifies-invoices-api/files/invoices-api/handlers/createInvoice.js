import * as service from "../lib/invoiceService.js";
import { formatInvoice } from "../lib/format.js";

// POST /invoices
export function createInvoice(body) {
  if (!body || typeof body.customerId !== "string" || !body.customerId) {
    return { status: 400, body: { error: "customerId is required" } };
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { status: 400, body: { error: "lines must be a non-empty array" } };
  }
  for (const l of body.lines) {
    if (typeof l.sku !== "string" || !Number.isInteger(l.qty) || l.qty < 1 || typeof l.unitPrice !== "number" || l.unitPrice < 0) {
      return { status: 400, body: { error: "each line needs sku, a positive integer qty and a unitPrice" } };
    }
  }
  const dueDate = body.dueDate ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const inv = service.add({ customerId: body.customerId, status: "open", dueDate, lines: body.lines });
  return { status: 201, body: formatInvoice(inv) };
}
