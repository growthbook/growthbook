import * as Sentry from "@sentry/react";
import { useRouter } from "next/router";
import { isSentryEnabled } from "@/services/env";

export default function Custom404() {
  const ind = Math.ceil(Math.random() * 2);
  const router = useRouter();
  if (isSentryEnabled()) {
    const badPath = router?.asPath || window?.location?.href || "";
    const referrer = document?.referrer || "";
    Sentry.captureMessage("404: " + badPath + " from " + referrer);
  }
  return (
    <div className="container d-flex justify-content-center h-100 align-items-center flex-column">
      <img
        src={`/images/errors/404-${ind}.png`}
        alt="404"
        style={{ maxWidth: "400px", width: "50%", minWidth: "230px" }}
      />
      <div className="text-center">
        <span
          className="font-weight-semibold mb-1"
          style={{ fontSize: "1.1rem" }}
        >
          404 - Page Not Found
        </span>
        <br />
        We looked, but we couldn&apos;t find the page you&apos;re looking for
      </div>
    </div>
  );
}
