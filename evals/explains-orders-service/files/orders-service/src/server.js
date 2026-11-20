import http from "node:http";
import { config } from "./config.js";
import { validateOrder } from "./orders/validate.js";
import { placeOrder, getOrder, cancelOrder, NotFoundError, ConflictError } from "./orders/service.js";
import { OutOfStockError } from "./inventory/index.js";
import { PaymentDeclinedError } from "./payments/client.js";
import { registerJobs } from "./jobs/index.js";
import { startWorker } from "./queue.js";

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function toHttp(res, err) {
  if (err instanceof NotFoundError) return send(res, 404, { error: "not_found" });
  if (err instanceof ConflictError) return send(res, 409, { error: "conflict", message: err.message });
  if (err instanceof OutOfStockError) return send(res, 409, { error: "out_of_stock", sku: err.sku });
  if (err instanceof PaymentDeclinedError) return send(res, 402, { error: "payment_declined", reason: err.reason });
  console.error(err);
  return send(res, 500, { error: "internal" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const m = url.pathname.match(/^\/orders\/([\w-]+)(\/cancel)?$/);
  try {
    if (req.method === "POST" && url.pathname === "/orders") {
      const body = await readJson(req);
      const errors = validateOrder(body);
      if (errors.length) return send(res, 400, { error: "invalid", details: errors });
      return send(res, 201, await placeOrder(body));
    }
    if (req.method === "GET" && m && !m[2]) return send(res, 200, getOrder(m[1]));
    if (req.method === "POST" && m && m[2]) return send(res, 200, await cancelOrder(m[1]));
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    return send(res, 404, { error: "not_found" });
  } catch (err) {
    return toHttp(res, err);
  }
});

registerJobs();
startWorker();
server.listen(config.port, () => console.log(`orders-service on :${config.port}`));
