// Hidden acceptance suite for simplifies-invoices-api: the behaviour the simplified code must keep.
// Not given to the agent. Run: APP_DIR=<project>/invoices-api node --test acceptance.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const dir = process.env.APP_DIR;
const port = 41000 + Math.floor(Math.random() * 2000);
const base = `http://127.0.0.1:${port}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server.js"], { cwd: dir, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 5000);
    proc.stdout.on("data", (d) => { if (String(d).includes(String(port))) { clearTimeout(t); resolve(); } });
    proc.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
});
after(() => proc?.kill());

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body: typeof body === "string" ? body : body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

const inv1 = {
  id: 1, customerId: "c-acme", status: "open", dueDate: "2026-12-01", paidAt: null,
  lines: [{ sku: "hosting", qty: 1, unitPrice: 120, total: 120 }, { sku: "support", qty: 3, unitPrice: 45.5, total: 136.5 }],
  subtotal: 256.5, tax: 20.52, total: 277.02,
};

test("lists every invoice by due date, formatted", async () => {
  const r = await call("GET", "/invoices");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((i) => i.id), [3, 2, 1]);
  assert.deepEqual(r.body[2], inv1);
  assert.deepEqual(r.body[0], { id: 3, customerId: "c-acme", status: "open", dueDate: "2026-10-15", paidAt: null, lines: [{ sku: "domain", qty: 1, unitPrice: 14.99, total: 14.99 }], subtotal: 14.99, tax: 1.2, total: 16.19 });
});

test("filters by status", async () => {
  const r = await call("GET", "/invoices?status=paid");
  assert.deepEqual(r.body.map((i) => [i.id, i.paidAt]), [[2, "2026-10-28T10:00:00.000Z"]]);
});

test("lists a customer's invoices by due date", async () => {
  assert.deepEqual((await call("GET", "/customers/c-acme/invoices")).body.map((i) => i.id), [3, 1]);
  const none = await call("GET", "/customers/c-nobody/invoices");
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, []);
});

test("gets one invoice", async () => {
  const r = await call("GET", "/invoices/1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, inv1);
});

test("a missing invoice is a 500 today (bug kept unless the user approves the fix)", async () => {
  assert.deepEqual(await call("GET", "/invoices/999"), { status: 500, body: { error: "internal" } });
  assert.deepEqual(await call("GET", "/invoices/abc"), { status: 500, body: { error: "internal" } });
});

test("validates new invoices", async () => {
  assert.deepEqual(await call("POST", "/invoices", { lines: [] }), { status: 400, body: { error: "customerId is required" } });
  assert.deepEqual(await call("POST", "/invoices", "not json"), { status: 400, body: { error: "customerId is required" } });
  assert.deepEqual(await call("POST", "/invoices", { customerId: "c-x", lines: [] }), { status: 400, body: { error: "lines must be a non-empty array" } });
  assert.deepEqual(await call("POST", "/invoices", { customerId: "c-x", lines: [{ sku: "a", qty: 0, unitPrice: 1 }] }),
    { status: 400, body: { error: "each line needs sku, a positive integer qty and a unitPrice" } });
});

test("creates, pays, and refuses to pay twice", async () => {
  const c = await call("POST", "/invoices", { customerId: "c-new", dueDate: "2027-01-31", lines: [{ sku: "x", qty: 2, unitPrice: 10 }] });
  assert.equal(c.status, 201);
  assert.deepEqual({ ...c.body, id: 0 }, { id: 0, customerId: "c-new", status: "open", dueDate: "2027-01-31", paidAt: null, lines: [{ sku: "x", qty: 2, unitPrice: 10, total: 20 }], subtotal: 20, tax: 1.6, total: 21.6 });
  const p = await call("POST", `/invoices/${c.body.id}/pay`);
  assert.equal(p.status, 200);
  assert.equal(p.body.status, "paid");
  assert.match(p.body.paidAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(await call("POST", `/invoices/${c.body.id}/pay`), { status: 409, body: { message: "Invoice already paid" } });
  assert.deepEqual(await call("POST", "/invoices/999/pay"), { status: 404, body: { message: "Invoice not found" } });
});

test("unknown routes are 404", async () => {
  assert.deepEqual(await call("GET", "/nope"), { status: 404, body: { error: "not_found" } });
  assert.deepEqual(await call("DELETE", "/invoices/1"), { status: 404, body: { error: "not_found" } });
});
