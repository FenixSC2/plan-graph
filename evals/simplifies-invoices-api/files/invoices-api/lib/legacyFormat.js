// v1 response shape, from before the 2.0 API. Kept for the old dashboard.
export function formatInvoiceV1(inv) {
  const amount = inv.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  return {
    invoice_id: String(inv.id),
    customer: inv.customerId,
    is_paid: inv.status === "paid",
    amount_due: inv.status === "paid" ? 0 : Math.round(amount * 108) / 100,
    due: inv.dueDate,
  };
}
