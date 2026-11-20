import http from "node:http";
import { listInvoices } from "./handlers/listInvoices.js";
import { customerInvoices } from "./handlers/customerInvoices.js";
import { getInvoice } from "./handlers/getInvoice.js";
import { createInvoice } from "./handlers/createInvoice.js";
import { payInvoice } from "./handlers/payInvoice.js";

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

async function route(req) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && url.pathname === "/invoices") return listInvoices(Object.fromEntries(url.searchParams));
  if (req.method === "POST" && url.pathname === "/invoices") return createInvoice(await readJson(req));
  if (req.method === "GET" && parts[0] === "invoices" && parts.length === 2) return getInvoice(parts[1]);
  if (req.method === "POST" && parts[0] === "invoices" && parts[2] === "pay" && parts.length === 3) return payInvoice(parts[1]);
  if (req.method === "GET" && parts[0] === "customers" && parts[2] === "invoices" && parts.length === 3) return customerInvoices(parts[1]);
  return { status: 404, body: { error: "not_found" } };
}

const server = http.createServer(async (req, res) => {
  let out;
  try {
    out = await route(req);
  } catch (err) {
    console.error(err);
    out = { status: 500, body: { error: "internal" } };
  }
  res.writeHead(out.status, { "content-type": "application/json" });
  res.end(JSON.stringify(out.body));
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`invoices-api on :${port}`));
