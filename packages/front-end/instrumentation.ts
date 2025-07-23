export async function register() {
  // NB: Sentry for client-side is setup in initEnv
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    const { default: Sentry } = await import("@sentry/nextjs");

    const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (sentryDsn) {
      Sentry.init({
        dsn: sentryDsn,
        sendDefaultPii: true,
        environment: process.env.NODE_ENV || "development",
      });
    }
  }
}
