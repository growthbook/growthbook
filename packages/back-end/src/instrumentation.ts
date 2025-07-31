// Warning: Careful importing other modules, as they and any dependencies they import won't be instrumented.
import * as Sentry from "@sentry/node";
import { getBuild } from "./util/build";

const SENTRY_DSN = process.env.SENTRY_DSN;
if (SENTRY_DSN) {
  const buildInfo = getBuild();
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: true,
    environment: process.env.NODE_ENV || "development",
    release: buildInfo.sha,
  });
  const buildDate = buildInfo.date;
  if (buildDate) {
    Sentry.setTag("build_date", buildDate);
  }
}
