export function validateOrder(body) {
  const errors = [];
  if (!body || typeof body !== "object") return ["body must be a JSON object"];
  if (typeof body.email !== "string" || !body.email.includes("@")) errors.push("email is required");
  if (typeof body.cardToken !== "string") errors.push("cardToken is required");
  if (!Array.isArray(body.items) || body.items.length === 0) errors.push("items must be a non-empty array");
  else for (const it of body.items) {
    if (typeof it.sku !== "string" || !Number.isInteger(it.qty) || it.qty < 1) errors.push(`bad item ${JSON.stringify(it)}`);
    if (typeof it.price !== "number" || it.price <= 0) errors.push(`bad price for ${it.sku}`);
  }
  return errors;
}
