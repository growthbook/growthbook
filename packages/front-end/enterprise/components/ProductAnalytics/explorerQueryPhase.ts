import type { ProductAnalyticsExploration } from "shared/validators";
import {
  hasSubmittablePayload,
  type ExplorerDraftConfig,
} from "@/enterprise/components/ProductAnalytics/util";

export type ExplorerQueryErrorKind = "timeout" | "query";

export type ExplorerQueryPhase =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "stale" }
  | { type: "success" }
  | { type: "error"; kind: ExplorerQueryErrorKind; message: string };

export type ExplorerFloatingCalloutModel = {
  status: "info" | "error";
  text: string;
  action: "retry" | "refresh" | null;
  title?: string;
};

export function getQueryTimeoutErrorMessage(isFunnel: boolean): string {
  return isFunnel
    ? "This query is taking longer than expected. Try a shorter date range or fewer steps, then run again."
    : "This query is taking longer than expected. Try a shorter date range, then run again.";
}

export function resolveExplorerQueryErrorKind({
  result,
  resultError,
  timeout = false,
}: {
  result: ProductAnalyticsExploration | null;
  resultError: string | null;
  timeout?: boolean;
}): ExplorerQueryErrorKind | null {
  if (timeout) return "timeout";
  if (
    resultError !== null ||
    result?.status === "error" ||
    Boolean(result?.error)
  ) {
    return "query";
  }
  return null;
}

export function getExplorerQueryPhase({
  loading,
  isStale,
  needsFetch,
  needsUpdate,
  errorKind,
  error,
  submittedExploreState,
}: {
  loading: boolean;
  isStale: boolean;
  needsFetch: boolean;
  needsUpdate: boolean;
  errorKind: ExplorerQueryErrorKind | null;
  error: string | null;
  submittedExploreState: ExplorerDraftConfig | null;
}): ExplorerQueryPhase {
  if (loading) return { type: "loading" };
  if (!hasSubmittablePayload(submittedExploreState)) return { type: "idle" };

  // Cache-miss auto-submits keep errorKind and set needsFetch, so they count as stale.
  const lastAttemptApplies = !needsFetch && !needsUpdate;
  if (lastAttemptApplies && errorKind !== null) {
    return {
      type: "error",
      kind: errorKind,
      message: error ?? "",
    };
  }
  if (isStale || needsFetch) return { type: "stale" };
  return { type: "success" };
}

export function getExplorerFloatingCallout(
  phase: ExplorerQueryPhase,
): ExplorerFloatingCalloutModel | null {
  switch (phase.type) {
    case "loading":
      return { status: "info", text: "Loading...", action: null };
    case "stale":
      return {
        status: "info",
        text: "Latest changes not applied",
        action: "refresh",
        title:
          "Some configuration changes require running a new SQL query against your data source",
      };
    case "error":
      return {
        status: "error",
        text: phase.kind === "timeout" ? "Query timed out" : "Query failed",
        action: "retry",
      };
    case "idle":
    case "success":
      return null;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
