import { useCallback, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { isDimensionPrecomputed } from "shared/experiments";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { trackSnapshot } from "@/services/track";

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

  // Low-level primitive: POST a snapshot for an explicit dimension. Callers that
  // already know the dimension to run (force re-run, "go to overall results",
  // dimension-only breakdown) use this directly. `submitUpdate` resolves the
  // dimension from props and gates on `customValidation` before delegating here.
  const runSnapshot = useCallback(
    async (
      dimensionToRun: string,
      opts?: { force?: boolean; trackingSource?: string },
    ): Promise<void> => {
      if (!experiment) return;
      setLoading(true);
      setLongResult(false);
      setRefreshError("");
      const timer = setTimeout(() => setLongResult(true), 5000);
      try {
        const force = opts?.force ?? false;
        const datasource = experiment.datasource
          ? (getDatasourceById(experiment.datasource) ?? undefined)
          : undefined;
        const { snapshot } = await apiCall<{
          snapshot: ExperimentSnapshotInterface;
        }>(
          `/experiment/${experiment.id}/snapshot${force ? "?force=true" : ""}`,
          {
            method: "POST",
            body: JSON.stringify({ phase, dimension: dimensionToRun }),
          },
        );
        const trackingSource =
          opts?.trackingSource ??
          experimentSnapshotTrackingProps?.trackingSource;
        if (trackingSource) {
          trackSnapshot(
            "create",
            trackingSource,
            experimentSnapshotTrackingProps?.datasourceType ??
              datasource?.type ??
              null,
            snapshot,
          );
        }
        onSuccess?.();
      } catch (e) {
        setRefreshError(e.message);
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
      setRefreshError,
      mutate,
      mutateAdditional,
    ],
  );

  const submitUpdate = useCallback(async () => {
    if (!experiment) return;
    if (customValidation && !(await customValidation())) {
      return;
    }
    const datasource = experiment.datasource
      ? (getDatasourceById(experiment.datasource) ?? undefined)
      : undefined;
    await runSnapshot(
      getSnapshotDimensionForPostRequest({
        dimension,
        experiment,
        datasource,
        hasPipelineModeFeature: hasCommercialFeature("pipeline-mode"),
      }),
    );
  }, [
    customValidation,
    runSnapshot,
    dimension,
    experiment,
    getDatasourceById,
    hasCommercialFeature,
  ]);

  return {
    submitUpdate,
    runSnapshot,
    loading,
    longResult,
  };
}
