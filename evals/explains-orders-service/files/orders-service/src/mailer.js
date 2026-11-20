import { config } from "./config.js";

export async function send(to, subject, text) {
  const res = await fetch(config.mailUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to, subject, text }),
  });
  if (!res.ok) throw new Error(`Mail API returned ${res.status}`);
}
