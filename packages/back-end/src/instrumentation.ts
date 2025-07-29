import * as Sentry from "@sentry/node";
import { getBuild } from "./util/handler";

const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  const buildInfo = getBuild();
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: true,
    environment: process.env.NODE_ENV || "development",
  });
  const buildDate = buildInfo.date;
  if (buildDate) {
    Sentry.setTag("build_date", buildDate);
  }
}
