// In-memory tables. Swapped for Postgres in production via the same interface.
const tables = {
  orders: new Map(),
  stock: new Map([["sku-mug", 12], ["sku-tee", 40], ["sku-cap", 0]]),
};

export const db = {
  orders: {
    insert(order) { tables.orders.set(order.id, order); return order; },
    get(id) { return tables.orders.get(id) ?? null; },
    update(id, patch) {
      const o = tables.orders.get(id);
      if (!o) return null;
      const next = { ...o, ...patch };
      tables.orders.set(id, next);
      return next;
    },
  },
  stock: {
    get(sku) { return tables.stock.get(sku); },
    set(sku, qty) { tables.stock.set(sku, qty); },
  },
};
