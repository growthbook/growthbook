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

type TrackEventProps = Record<string, unknown>;

export interface TrackSnapshotProps {
  id: string;
  source: string;
  experiment: string;
  engine: StatsEngine;
  datasource_type: string | null;
  regression_adjustment_enabled: boolean;
  sequential_testing_enabled: boolean;
  sequential_testing_tuning_parameter?: number;
  skip_partial_data: boolean;
  activation_metric_selected: boolean;
  query_filter_selected: boolean;
  segment_selected: boolean;
  dimension: string;
  error?: string;
}

let jitsu: JitsuClient;
export default function track(
  event: string,
  props: TrackEventProps = {}
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
  props: TrackSnapshotProps
): void {
  track("Experiment Snapshot: " + event, cleanSnapshotProps(props));
}

export function trackReport(
  event: "create" | "update" | "refresh" | "error" | "delete",
  props?: TrackSnapshotProps
): void {
  track("Experiment Report: " + event, props ? cleanSnapshotProps(props) : {});
}

function cleanSnapshotProps(props: TrackSnapshotProps): TrackEventProps {
  const parsedDim = parseSnapshotDimension(props.dimension);

  const trackEventProps: TrackEventProps = {
    ...props,
    dimension_type: parsedDim.type,
    dimension_id: parsedDim.id,
    // Overwrite `id` and `experiment`
    id: props.id ? md5(props.id) : "",
    experiment: props.experiment ? md5(props.experiment) : "",
  };
  delete trackEventProps.dimension;
  return trackEventProps;
}

export function parseSnapshotDimension(
  dimension: string
): { type: string; id: string } {
  if (!dimension) {
    return { type: "none", id: "" };
  }
  if (dimension.substring(0, 4) === "pre:") {
    return { type: "predefined", id: dimension.substring(4) };
  }
  if (dimension.substring(0, 4) === "exp:") {
    return { type: "experiment", id: md5(dimension.substring(4)) };
  }
  return { type: "user", id: md5(dimension) };
}
