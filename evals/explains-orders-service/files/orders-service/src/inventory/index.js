import { db } from "../db.js";

export class OutOfStockError extends Error {
  constructor(sku) { super(`Out of stock: ${sku}`); this.sku = sku; }
}

// Takes items out of stock. All or nothing: checks every line before decrementing any.
export function reserve(items) {
  for (const { sku, qty } of items) {
    const have = db.stock.get(sku);
    if (have === undefined) throw new Error(`Unknown sku: ${sku}`);
    if (have < qty) throw new OutOfStockError(sku);
  }
  for (const { sku, qty } of items) db.stock.set(sku, db.stock.get(sku) - qty);
}

// Puts items back, e.g. when an order is cancelled.
export function release(items) {
  for (const { sku, qty } of items) db.stock.set(sku, (db.stock.get(sku) ?? 0) + qty);
}
