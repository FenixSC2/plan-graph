// In-memory invoice store, seeded with a few invoices.
let nextId = 4;
const invoices = [
  { id: 1, customerId: "c-acme", status: "open", dueDate: "2026-12-01", lines: [{ sku: "hosting", qty: 1, unitPrice: 120 }, { sku: "support", qty: 3, unitPrice: 45.5 }] },
  { id: 2, customerId: "c-globex", status: "paid", dueDate: "2026-11-01", paidAt: "2026-10-28T10:00:00.000Z", lines: [{ sku: "hosting", qty: 2, unitPrice: 120 }] },
  { id: 3, customerId: "c-acme", status: "open", dueDate: "2026-10-15", lines: [{ sku: "domain", qty: 1, unitPrice: 14.99 }] },
];

export function all() {
  return invoices.slice();
}

export function byId(id) {
  return invoices.find((i) => i.id === id);
}

export function insert(inv) {
  const row = { ...inv, id: nextId++ };
  invoices.push(row);
  return row;
}

export function update(id, patch) {
  const i = invoices.findIndex((x) => x.id === id);
  if (i === -1) return undefined;
  invoices[i] = { ...invoices[i], ...patch };
  return invoices[i];
}
