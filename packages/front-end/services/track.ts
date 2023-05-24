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
import md5 from "md5";
import { StatsEngine } from "@/../back-end/types/stats";
import { getCurrentUser } from "./UserContext";
import {
  getGrowthBookBuild,
  hasFileConfig,
  inTelemetryDebugMode,
  isCloud,
  isTelemetryEnabled,
} from "./env";

let jitsu: JitsuClient;
export default function track(
  event: string,
  props: Record<string, unknown> = {}
): void {
  // Only run client-side, not during SSR
  if (typeof window === "undefined") return;

  const build = getGrowthBookBuild();

  const currentUser = getCurrentUser();
  const org = currentUser?.org;
  const id = currentUser?.id;
  const role = currentUser?.role;

  // Mask the hostname and sanitize URLs to avoid leaking private info
  const isLocalhost = !!location.hostname.match(/(localhost|127\.0\.0\.1)/i);
  const host = isLocalhost ? "localhost" : isCloud() ? "cloud" : "self-hosted";
  const trackProps = {
    ...props,
    page_url: location.pathname,
    page_title: "",
    source_ip: "",
    url: document.location.protocol + "//" + host + location.pathname,
    doc_host: host,
    doc_search: "",
    doc_path: location.pathname,
    referer: "",
    build_sha: build.sha,
    build_date: build.date,
    configFile: hasFileConfig(),
    role: id ? role : "",
    // Track anonymous hashed identifiers for all deployments
    org_hash: org ? md5(org) : "",
    user_id_hash: id ? md5(id) : "",
    // Only track un-hashed identifiers on the managed cloud for priority support
    user_id: isCloud() ? id : "",
    org: isCloud() ? org : "",
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

export function trackSnapshot(
  event: "create" | "update" | "delete" | "error",
  props: {
    source: string;
    experiment: string;
    engine: StatsEngine;
    regressionAdjustmentEnabled: boolean;
    sequentialTestingEnabled: boolean;
    sequentialTestingTuningParameter?: number;
    skipPartialData: boolean;
    activationMetricSelected: boolean;
    queryFilterSelected: boolean;
    segmentSelected: boolean;
    dimension: string;
    error?: string;
  }
): void {
  props.experiment = md5(props.experiment);
  props.dimension = props.dimension ? md5(props.dimension) : "";
  track("Experiment Snapshot: " + event, props);
}
