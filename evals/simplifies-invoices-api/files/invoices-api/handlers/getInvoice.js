import * as service from "../lib/invoiceService.js";
import { formatInvoice } from "../lib/format.js";

// GET /invoices/:id
export function getInvoice(id) {
  const inv = service.getById(Number(id));
  if (inv === null) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: formatInvoice(inv) };
}
