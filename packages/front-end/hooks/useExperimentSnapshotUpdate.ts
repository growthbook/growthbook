import { useCallback, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { isDimensionPrecomputed } from "shared/experiments";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { trackSnapshot } from "@/services/track";

export type SnapshotRefreshBlocker = {
  kind: "requires-full-refresh";
  reason: string;
};

type SubmitUpdateOptions = {
  force?: boolean;
  fullRefreshReasons?: string[];
};

type PostSnapshotResult =
  | { status: "success" }
  | { status: "needs-full-refresh"; reason: string }
  | { status: "failed" };

function apiErrorToSnapshotRefreshBlocker(
  err: unknown,
): SnapshotRefreshBlocker | null {
  if (!err || typeof err !== "object" || !("code" in err)) {
    return null;
  }
  if (err.code !== "requires_full_refresh" || !("details" in err)) {
    return null;
  }
  const details = err.details;
  if (
    !details ||
    typeof details !== "object" ||
    !("reason" in details) ||
    typeof details.reason !== "string"
  ) {
    return null;
  }

  return { kind: "requires-full-refresh", reason: details.reason };
}

function getSnapshotDimensionForPostRequest({
  dimension,
  experiment,
  datasource,
  hasPipelineModeFeature,
}: {
  dimension?: string;
  experiment: ExperimentInterfaceStringDates;
  datasource?: DataSourceInterfaceWithParams;
  hasPipelineModeFeature: boolean;
}): string {
  return isDimensionPrecomputed(
    dimension,
    getHonoredPrecomputedUnitDimensionIds(
      experiment.precomputedUnitDimensionIds,
      datasource,
      hasPipelineModeFeature,
    ),
  )
    ? ""
    : (dimension ?? "");
}

export function useExperimentSnapshotUpdate({
  experiment,
  phase,
  dimension,
  mutate,
  mutateAdditional,
  setRefreshError,
  onSuccess,
  customValidation,
  onSnapshotRefreshBlocked,
  experimentSnapshotTrackingProps,
}: {
  // Optional so a host component that also serves non-experiment entities (e.g.
  // safe rollouts) can call the hook unconditionally; the update functions
  // no-op until an experiment is present.
  experiment: ExperimentInterfaceStringDates | undefined;
  phase: number;
  dimension?: string;
  mutate: () => void;
  mutateAdditional?: () => void;
  setRefreshError: (error: string) => void;
  onSuccess?: () => void;
  // Return false to abort the refresh (e.g. to open a confirmation dialog
  // instead). Mirrors Modal's customValidation. Side effects are allowed.
  customValidation?: () => boolean | Promise<boolean>;
  onSnapshotRefreshBlocked?: (blocker: SnapshotRefreshBlocker) => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
}) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);

  const [fullRefreshReasons, setFullRefreshReasons] = useState<string[] | null>(
    null,
  );
  const fullRefreshResolveRef = useRef<((proceed: boolean) => void) | null>(
    null,
  );

  const promptFullRefresh = useCallback(
    (reasons: string[]): Promise<boolean> => {
      fullRefreshResolveRef.current?.(false);
      setFullRefreshReasons(reasons);
      return new Promise<boolean>((resolve) => {
        fullRefreshResolveRef.current = resolve;
      });
    },
    [],
  );

  const resolveFullRefresh = useCallback((proceed: boolean) => {
    setFullRefreshReasons(null);
    fullRefreshResolveRef.current?.(proceed);
    fullRefreshResolveRef.current = null;
  }, []);

  // POST once and normalize structured full-refresh errors for callers.
  const postSnapshot = useCallback(
    async (
      dimensionToRun: string,
      force: boolean,
      trackingSourceOverride?: string,
    ): Promise<PostSnapshotResult> => {
      if (!experiment) return { status: "failed" };
      setLoading(true);
      setLongResult(false);
      setRefreshError("");
      const timer = setTimeout(() => setLongResult(true), 5000);
      let apiError: unknown = null;
      try {
        const datasource = experiment.datasource
          ? (getDatasourceById(experiment.datasource) ?? undefined)
          : undefined;
        const res = await apiCall<{
          status: 200;
          snapshot: ExperimentSnapshotInterface;
        }>(
          `/experiment/${experiment.id}/snapshot${force ? "?force=true" : ""}`,
          {
            method: "POST",
            body: JSON.stringify({ phase, dimension: dimensionToRun }),
          },
          (errBody) => {
            apiError = errBody;
          },
        );
        const trackingSource =
          trackingSourceOverride ??
          experimentSnapshotTrackingProps?.trackingSource;
        if (trackingSource) {
          trackSnapshot(
            "create",
            trackingSource,
            experimentSnapshotTrackingProps?.datasourceType ??
              datasource?.type ??
              null,
            res.snapshot,
          );
        }
        onSuccess?.();
        return { status: "success" };
      } catch (e) {
        const blocker = apiErrorToSnapshotRefreshBlocker(apiError);
        if (blocker) {
          if (dimensionToRun === "") {
            if (force) {
              setRefreshError(blocker.reason);
              return { status: "failed" };
            }
            return { status: "needs-full-refresh", reason: blocker.reason };
          }
          onSnapshotRefreshBlocked?.(blocker);
          return { status: "failed" };
        }
        setRefreshError(e.message);
        return { status: "failed" };
      } finally {
        clearTimeout(timer);
        setLoading(false);
        mutate();
        mutateAdditional?.();
      }
    },
    [
      apiCall,
      experiment,
      getDatasourceById,
      phase,
      experimentSnapshotTrackingProps,
      onSuccess,
      onSnapshotRefreshBlocked,
      setRefreshError,
      mutate,
      mutateAdditional,
    ],
  );

  // Returns true only when a snapshot refresh starts.
  const runSnapshot = useCallback(
    async (
      dimensionToRun: string,
      opts?: { force?: boolean; trackingSource?: string },
    ): Promise<boolean> => {
      const result = await postSnapshot(
        dimensionToRun,
        opts?.force ?? false,
        opts?.trackingSource,
      );
      if (result.status !== "needs-full-refresh") {
        return result.status === "success";
      }
      if (!(await promptFullRefresh([result.reason]))) return false;
      const retry = await postSnapshot(
        dimensionToRun,
        true,
        opts?.trackingSource,
      );
      return retry.status === "success";
    },
    [postSnapshot, promptFullRefresh],
  );

  const submitUpdate = useCallback(
    async (options: SubmitUpdateOptions = {}) => {
      if (!experiment) return;
      if (customValidation && !(await customValidation())) {
        return;
      }
      const datasource = experiment.datasource
        ? (getDatasourceById(experiment.datasource) ?? undefined)
        : undefined;
      const resolvedDimension = getSnapshotDimensionForPostRequest({
        dimension,
        experiment,
        datasource,
        hasPipelineModeFeature: hasCommercialFeature("pipeline-mode"),
      });
      const force = options.force ?? false;
      if (
        force &&
        options.fullRefreshReasons !== undefined &&
        !(await promptFullRefresh(options.fullRefreshReasons))
      ) {
        return;
      }
      await runSnapshot(resolvedDimension, { force });
    },
    [
      customValidation,
      runSnapshot,
      dimension,
      experiment,
      getDatasourceById,
      hasCommercialFeature,
      promptFullRefresh,
    ],
  );

  return {
    submitUpdate,
    runSnapshot,
    loading,
    longResult,
    fullRefreshConfirm: {
      open: fullRefreshReasons !== null,
      reasons: fullRefreshReasons ?? [],
      onConfirm: () => resolveFullRefresh(true),
      onCancel: () => resolveFullRefresh(false),
    },
  };
}
