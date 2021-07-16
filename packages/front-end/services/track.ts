/* 
Track anonymous usage statistics
- No identifiable information is sent.
- Helps us figure out how often features are used so we can prioritize development
- For example, if people start creating a metric and then 
  abandon the form, that tells us the UI needs improvement.
- You can disable this tracking completely by setting 
  DISABLE_TELEMETRY=1 in your env.
*/

import { jitsuClient, JitsuClient } from "@jitsu/sdk-js";
import { inTelemetryDebugMode, isCloud, isTelemetryEnabled } from "./env";

let jitsu: JitsuClient;
export default function track(
  event: string,
  props: Record<string, unknown> = {}
): void {
  // Only run client-side, not during SSR
  if (typeof window === "undefined") return;

  // Mask the hostname and sanitize URLs to avoid leaking private info
  const isLocalhost = !!location.hostname.match(/(localhost|127\.0\.0\.1)/i);
  const host = isLocalhost ? "localhost" : isCloud() ? "cloud" : "self-hosted";
  const trackProps = {
    ...props,
    org_hash: window["gbOrgHash"] || "",
    page_url: location.pathname,
    page_title: "",
    source_ip: "",
    url: document.location.protocol + "//" + host + location.pathname,
    doc_host: host,
    doc_search: "",
    doc_path: location.pathname,
    referer: "",
  };

  if (inTelemetryDebugMode()) {
    console.log("Telemetry Event - ", event, trackProps);
  }
  if (!isTelemetryEnabled()) return;

  if (!jitsu) {
    jitsu = jitsuClient({
      key: "js.y6nea.yo6e8isxplieotd6zxyeu5",
      log_level: "ERROR",
      tracking_host: "https://t.growthbook.io",
      cookie_name: "__growthbookid",
      capture_3rd_party_cookies: false,
      randomize_url: true,
    });
  }

  jitsu.track(event, trackProps);
}
