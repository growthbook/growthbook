import { IncrementalFallbackCode } from "shared/validators";

export type FallbackVisibility = "callout" | "muted" | "none";

export type FallbackCopy = {
  summary: string;
  detail: string;
  visibility: FallbackVisibility;
};

const COPY: Record<IncrementalFallbackCode, FallbackCopy> = {
  "settings-outdated": {
    summary: "Experiment settings have changed",
    detail:
      "The incremental pipeline was built with different analysis settings. Updates will run as full queries and pipeline tables will stop advancing until a Full Refresh is performed. Run a Full Refresh to rebuild the pipeline and resume incremental updates.",
    visibility: "callout",
  },
  "non-fact-metrics": {
    summary: "Non-fact metrics detected",
    detail:
      "Only fact metrics are supported with incremental refresh. Switch to fact metrics to re-enable incremental updates.",
    visibility: "callout",
  },
  "no-metrics-selected": {
    summary: "No metrics selected",
    detail:
      "At least one metric must be selected to use incremental refresh. Add metrics to re-enable incremental updates.",
    visibility: "callout",
  },
  "event-quantile-metric": {
    summary: "Event quantile metric not supported",
    detail:
      "This datasource does not support event quantile metrics with incremental refresh. Remove event quantile metrics or switch to a supported datasource.",
    visibility: "callout",
  },
  "activation-metric": {
    summary: "Activation metric not supported",
    detail:
      "Activation metrics are not supported with incremental refresh while in beta. Remove the activation metric to re-enable incremental updates.",
    visibility: "callout",
  },
  "skip-partial-data": {
    summary: '"Exclude In-Progress Conversions" not supported',
    detail:
      'Incremental refresh does not support "Exclude In-Progress Conversions". Change the conversion window setting to "Include" to re-enable incremental updates.',
    visibility: "callout",
  },
  "experiment-type": {
    summary: "Experiment type not supported",
    detail: "Incremental refresh is only supported for standard experiments.",
    visibility: "none",
  },
  "no-materialized-units-table": {
    summary: "No incremental data available yet",
    detail:
      "Run a standard update first to initialize the incremental pipeline.",
    visibility: "none",
  },
  "datasource-unsupported": {
    summary: "Datasource does not support incremental refresh",
    detail:
      "This datasource integration does not support incremental queries. Contact support or switch to a supported datasource.",
    visibility: "muted",
  },
  "missing-premium-feature": {
    summary: "Incremental refresh requires a Pro plan",
    detail: "Upgrade to a Pro plan or higher to use incremental refresh.",
    visibility: "muted",
  },
  "not-enabled": {
    summary: "Incremental refresh not enabled",
    detail:
      "Incremental refresh is not enabled for this experiment on this datasource.",
    visibility: "none",
  },
  unknown: {
    summary: "Incremental refresh unavailable",
    detail:
      "An unexpected error occurred while checking incremental refresh eligibility.",
    visibility: "muted",
  },
};

export function getFallbackCopy(code: IncrementalFallbackCode): FallbackCopy {
  return COPY[code];
}
