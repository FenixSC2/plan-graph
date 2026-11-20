import * as service from "../lib/invoiceService.js";

const TAX_RATE = 0.08;

// GET /customers/:id/invoices
export function customerInvoices(customerId) {
  const rows = service.getAll().filter((inv) => inv.customerId === customerId);
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const out = [];
  for (const inv of rows) {
    const lines = inv.lines.map((l) => ({ ...l, total: Math.round(l.qty * l.unitPrice * 100) / 100 }));
    const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
    out.push({
      id: inv.id,
      customerId: inv.customerId,
      status: inv.status,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt ?? null,
      lines,
      subtotal,
      tax,
      total: Math.round((subtotal + tax) * 100) / 100,
    });
  }
  return { status: 200, body: out };
}
