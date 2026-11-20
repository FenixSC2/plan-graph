import * as service from "../lib/invoiceService.js";

const TAX_RATE = 0.08;

// GET /invoices?status=open|paid
export function listInvoices(query) {
  let rows = service.getAll();
  if (query.status) rows = rows.filter((inv) => inv.status === query.status);
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    status: 200,
    body: rows.map((inv) => {
      const lines = inv.lines.map((l) => ({ ...l, total: Math.round(l.qty * l.unitPrice * 100) / 100 }));
      const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
      const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
      return {
        id: inv.id,
        customerId: inv.customerId,
        status: inv.status,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt ?? null,
        lines,
        subtotal,
        tax,
        total: Math.round((subtotal + tax) * 100) / 100,
      };
    }),
  };
}
