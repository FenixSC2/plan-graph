export const toCents = (amount) => Math.round(amount * 100);
export const formatCents = (cents) => `$${(cents / 100).toFixed(2)}`;
