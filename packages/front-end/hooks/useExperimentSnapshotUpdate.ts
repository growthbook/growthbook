import { useCallback, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import { isDimensionPrecomputed } from "shared/experiments";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { trackSnapshot } from "@/services/track";

export type SnapshotRefreshBlocker =
  | { kind: "requires-full-refresh"; reason: string }
  | { kind: "requires-overall-update"; reason: string };

type SubmitUpdateOptions = {
  force?: boolean;
  fullRefreshReasons?: string[];
};

type SnapshotStatusCacheEntry = {
  latest: SnapshotStatusSummary | null;
};

function getSnapshotSummaryPath({
  experimentId,
  phase,
  dimension,
}: {
  experimentId: string;
  phase: number;
  dimension: string;
}): string {
  const query = new URLSearchParams({
    ...(dimension && { dimension }),
  }).toString();
  return (
    `/experiment/${experimentId}/snapshot-summary/${phase}` +
    (query ? `?${query}` : "")
  );
}

function toSnapshotStatusSummary(
  snapshot: ExperimentSnapshotInterface,
): SnapshotStatusSummary {
  return {
    id: snapshot.id,
    status: snapshot.status,
    error: snapshot.error,
    queries: snapshot.queries,
    runStarted: snapshot.runStarted,
    dateCreated: snapshot.dateCreated,
    multipleExposures: snapshot.multipleExposures,
    health: snapshot.health,
    banditResult: snapshot.banditResult,
    type: snapshot.type,
    triggeredBy: snapshot.triggeredBy,
  };
}

function apiErrorToSnapshotRefreshBlocker(
  err: { code?: string; details?: unknown } | null,
): SnapshotRefreshBlocker | null {
  if (
    !err?.details ||
    typeof err.details !== "object" ||
    !("reason" in err.details) ||
    typeof err.details.reason !== "string"
  ) {
    return null;
  }

  if (err?.code === "requires_full_refresh") {
    return { kind: "requires-full-refresh", reason: err.details.reason };
  }

  if (err?.code === "requires_overall_update") {
    return {
      kind: "requires-overall-update",
      reason: err.details.reason,
    };
  }

  return null;
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
  const { apiCall, orgId } = useAuth();
  const { mutate: mutateCache } = useSWRConfig();
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

  // Low-level primitive: POST a snapshot for an explicit dimension. Returns the
  // blocker reason when the backend needs a dimensionless full refresh, else null.
  const postSnapshot = useCallback(
    async (
      dimensionToRun: string,
      force: boolean,
      trackingSourceOverride?: string,
    ): Promise<string | null> => {
      if (!experiment) return null;
      setLoading(true);
      setLongResult(false);
      setRefreshError("");
      const timer = setTimeout(() => setLongResult(true), 5000);
      let apiError: { code?: string; details?: unknown } | null = null;
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
            apiError = errBody as { code?: string; details?: unknown };
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
        await mutateCache<SnapshotStatusCacheEntry>(
          `${orgId}::${getSnapshotSummaryPath({
            experimentId: experiment.id,
            phase,
            dimension: dimensionToRun,
          })}`,
          { latest: toSnapshotStatusSummary(res.snapshot) },
          { revalidate: false },
        );
        onSuccess?.();
        return null;
      } catch (e) {
        const blocker = apiErrorToSnapshotRefreshBlocker(apiError);
        if (blocker) {
          if (blocker.kind === "requires-full-refresh") {
            if (dimensionToRun === "") {
              return force ? null : blocker.reason;
            }
            onSnapshotRefreshBlocked?.(blocker);
            return null;
          }
          onSnapshotRefreshBlocked?.(blocker);
          return null;
        }
        setRefreshError(e.message);
        return null;
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
      mutateCache,
      orgId,
      phase,
      experimentSnapshotTrackingProps,
      onSuccess,
      onSnapshotRefreshBlocked,
      setRefreshError,
      mutate,
      mutateAdditional,
    ],
  );

  // Callers that already know the dimension to run (force re-run, "go to
  // overall results", dimension-only breakdown) use this directly. `submitUpdate`
  // resolves the dimension from props and gates on `customValidation` first. An
  // outdated incremental cache prompts for a full refresh, then re-posts forced.
  const runSnapshot = useCallback(
    async (
      dimensionToRun: string,
      opts?: { force?: boolean; trackingSource?: string },
    ): Promise<void> => {
      const reason = await postSnapshot(
        dimensionToRun,
        opts?.force ?? false,
        opts?.trackingSource,
      );
      if (reason === null) return;
      if (await promptFullRefresh([reason])) {
        await postSnapshot(dimensionToRun, true, opts?.trackingSource);
      }
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
