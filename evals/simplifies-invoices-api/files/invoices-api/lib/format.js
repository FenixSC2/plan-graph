export const TAX_RATE = 0.08;

// The shape every endpoint returns for an invoice.
export function formatInvoice(inv) {
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
}
