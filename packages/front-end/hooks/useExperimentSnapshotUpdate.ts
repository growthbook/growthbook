import { useCallback, useRef, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  SnapshotUpdateScopeKind,
} from "shared/types/experiment-snapshot";
import { isDimensionPrecomputed } from "shared/experiments";
import type { PostExperimentSnapshotBody } from "shared/validators";
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
  updateScope?: SnapshotUpdateScopeKind;
};

type PostSnapshotOptions = {
  force?: boolean;
  trackingSource?: string;
  updateScope?: SnapshotUpdateScopeKind;
};

type PostSnapshotResult =
  | { status: "success" }
  | { status: "needs-full-refresh"; reason: string }
  | { status: "failed" };

// Shown while the update it names runs.
export type SnapshotUpdateNotice = { snapshotId: string; message: string };

const NEW_METRICS_FALLBACK_NOTICE =
  "New metrics can't be updated on their own right now, so all metrics are being updated.";

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
  // Refetches the latest snapshot; a returned promise settles once it has.
  mutate: () => Promise<unknown> | void;
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
  // Set from a submit until it fails or the refetch shows its update, so a
  // second click, even in the same tick, can't start another.
  const submittingRef = useRef(false);
  // Set when the back end ran a normal update in place of the new-metrics one.
  const [notice, setNotice] = useState<SnapshotUpdateNotice | null>(null);
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
      {
        force = false,
        trackingSource: trackingSourceOverride,
        updateScope,
      }: PostSnapshotOptions = {},
    ): Promise<PostSnapshotResult> => {
      if (!experiment) return { status: "failed" };
      setLoading(true);
      setLongResult(false);
      setRefreshError("");
      setNotice(null);
      const timer = setTimeout(() => setLongResult(true), 5000);
      let apiError: unknown = null;
      let started = false;
      try {
        const datasource = experiment.datasource
          ? (getDatasourceById(experiment.datasource) ?? undefined)
          : undefined;
        const res = await apiCall<{
          status: 200;
          snapshot: ExperimentSnapshotInterface;
          updateScope: SnapshotUpdateScopeKind;
        }>(
          `/experiment/${experiment.id}/snapshot${force ? "?force=true" : ""}`,
          {
            method: "POST",
            body: JSON.stringify({
              phase,
              dimension: dimensionToRun,
              ...(updateScope ? { updateScope } : {}),
            } satisfies PostExperimentSnapshotBody),
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
        if (
          updateScope === "new_metrics" &&
          res.updateScope === "all_metrics"
        ) {
          setNotice({
            snapshotId: res.snapshot.id,
            message: NEW_METRICS_FALLBACK_NOTICE,
          });
        }
        onSuccess?.();
        started = true;
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
        const refetched = mutate();
        mutateAdditional?.();
        // Until the refetch shows the update running, the controls would
        // offer to start another. The update started even if the refetch fails.
        if (started) await Promise.resolve(refetched).catch(() => undefined);
        setLoading(false);
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
      opts?: PostSnapshotOptions,
    ): Promise<boolean> => {
      const result = await postSnapshot(dimensionToRun, opts);
      if (result.status !== "needs-full-refresh") {
        return result.status === "success";
      }
      if (!(await promptFullRefresh([result.reason]))) return false;
      // A confirmed Full Refresh recomputes every metric.
      const retry = await postSnapshot(dimensionToRun, {
        force: true,
        trackingSource: opts?.trackingSource,
      });
      return retry.status === "success";
    },
    [postSnapshot, promptFullRefresh],
  );

  const submitUpdate = useCallback(
    async (options: SubmitUpdateOptions = {}) => {
      if (!experiment || submittingRef.current) return;
      submittingRef.current = true;
      try {
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
        await runSnapshot(resolvedDimension, {
          force,
          updateScope: options.updateScope,
          ...(options.updateScope === "new_metrics"
            ? { trackingSource: "UpdateNewMetrics" }
            : {}),
        });
      } finally {
        submittingRef.current = false;
      }
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
    notice,
    fullRefreshConfirm: {
      open: fullRefreshReasons !== null,
      reasons: fullRefreshReasons ?? [],
      onConfirm: () => resolveFullRefresh(true),
      onCancel: () => resolveFullRefresh(false),
    },
  };
}
