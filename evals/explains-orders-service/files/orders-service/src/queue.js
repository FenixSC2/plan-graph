import { config } from "./config.js";

// A minimal in-process job queue. Handlers are registered by name in jobs/index.js.
const pending = [];
const handlers = new Map();

export function register(name, handler) { handlers.set(name, handler); }

export function enqueue(name, payload) {
  pending.push({ name, payload, enqueuedAt: Date.now() });
}

async function drain() {
  while (pending.length) {
    const job = pending.shift();
    const handler = handlers.get(job.name);
    if (!handler) { console.warn(`no handler for ${job.name}`); continue; }
    try {
      await handler(job.payload);
    } catch (err) {
      console.error(`job ${job.name} failed`, err.message);
    }
  }
}

export function startWorker() {
  setInterval(drain, config.queuePollMs);
}
