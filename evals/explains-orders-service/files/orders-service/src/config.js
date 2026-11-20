// Runtime configuration, read once at startup.
export const config = {
  port: Number(process.env.PORT ?? 8080),
  paymentsUrl: process.env.PAYMENTS_URL ?? "https://sandbox.payments.example/v1",
  paymentsKey: process.env.PAYMENTS_KEY ?? "",
  mailUrl: process.env.MAIL_URL ?? "https://mail.example/send",
  queuePollMs: Number(process.env.QUEUE_POLL_MS ?? 500),
};
