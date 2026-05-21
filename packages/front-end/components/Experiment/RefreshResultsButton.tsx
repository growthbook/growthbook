import React from "react";
import { Queries } from "shared/types/query";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isDimensionPrecomputed } from "shared/experiments";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import { getHonoredPrecomputedUnitDimensionIds } from "@/services/experiments";
import { trackSnapshot } from "@/services/track";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ExperimentRefreshSnapshotButton from "@/components/Experiment/RefreshSnapshotButton";
import SafeRolloutRefreshSnapshotButton from "@/components/SafeRollout/RefreshSnapshotButton";

export type EntityType = "experiment" | "holdout" | "safe-rollout";

export interface RefreshResultsButtonProps<
  T extends {
    id: string;
    queries?: Queries;
    runStarted?: string | Date | null;
  },
> {
  entityType: EntityType;
  entityId: string;
  datasourceId?: string | null;
  latest?: T;
  mutate: () => void;
  mutateAdditional?: () => void;
  setRefreshError: (error: string) => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
  onSuccess?: () => void;
  // Experiment/holdout-specific props
  experiment?: ExperimentInterfaceStringDates;
  phase?: number;
  dimension?: string;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  // SafeRollout-specific props
  safeRollout?: SafeRolloutInterface;
}

export default function RefreshResultsButton<
  T extends {
    id: string;
    queries?: Queries;
    runStarted?: string | Date | null;
  },
>({
  entityType,
  entityId,
  datasourceId,
  latest,
  mutate,
  mutateAdditional,
  setRefreshError,
  experimentSnapshotTrackingProps,
  onSuccess,
  experiment,
  phase,
  dimension,
  safeRollout,
}: RefreshResultsButtonProps<T>) {
  const { apiCall } = useAuth();
  const { getDatasourceById } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const hasQueries = latest?.queries && latest.queries.length > 0;

  // Determine which button to render
  const shouldUseRunQueriesButton = datasourceId && latest && hasQueries;

  const shouldRenderExperimentButton =
    !shouldUseRunQueriesButton &&
    (entityType === "experiment" || entityType === "holdout") &&
    experiment &&
    phase !== undefined;

  const shouldRenderSafeRolloutButton =
    !shouldUseRunQueriesButton &&
    !shouldRenderExperimentButton &&
    entityType === "safe-rollout" &&
    safeRollout;

  // Endpoints for the various buttons
  const cancelEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/snapshot/${latest?.id}/cancel`
      : `/snapshot/${latest?.id}/cancel`;

  const snapshotEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/${entityId}/snapshot`
      : `/experiment/${entityId}/snapshot`;

  return (
    <>
      {shouldUseRunQueriesButton ? (
        <RunQueriesButton
          cta="Update"
          cancelEndpoint={cancelEndpoint}
          mutate={() => {
            mutate();
            mutateAdditional?.();
          }}
          model={{
            queries: latest.queries || [],
            runStarted: latest.runStarted ?? null,
          }}
          icon="refresh"
          useRadixButton={true}
          radixVariant="outline"
          onSubmit={async () => {
            // Precomputed dimensions are computed as part of a standard snapshot,
            // so we don't need to pass them to the backend for a new snapshot query
            const snapshotDimension = isDimensionPrecomputed(
              dimension,
              getHonoredPrecomputedUnitDimensionIds(
                experiment?.precomputedUnitDimensionIds,
                experiment?.datasource
                  ? getDatasourceById(experiment.datasource)
                  : undefined,
                hasCommercialFeature("pipeline-mode"),
              ),
            )
              ? ""
              : (dimension ?? "");
            const body =
              entityType === "experiment" || entityType === "holdout"
                ? JSON.stringify({
                    phase: phase ?? 0,
                    dimension: snapshotDimension,
                  })
                : undefined;

            try {
              if (entityType === "safe-rollout") {
                await apiCall<{ snapshot: SafeRolloutSnapshotInterface }>(
                  snapshotEndpoint,
                  { method: "POST" },
                );
              } else {
                const res = await apiCall<{
                  snapshot: ExperimentSnapshotInterface;
                }>(snapshotEndpoint, {
                  method: "POST",
                  ...(body && { body }),
                });
                if (experimentSnapshotTrackingProps) {
                  trackSnapshot(
                    "create",
                    experimentSnapshotTrackingProps.trackingSource,
                    experimentSnapshotTrackingProps.datasourceType,
                    res.snapshot,
                  );
                }
              }
              onSuccess?.();
              setRefreshError("");
            } catch (e) {
              setRefreshError(e.message);
            } finally {
              // Always refresh, regardless of success or failure
              // to give the UI a chance to catch up
              mutate();
              mutateAdditional?.();
            }
          }}
        />
      ) : shouldRenderExperimentButton ? (
        <ExperimentRefreshSnapshotButton
          mutate={() => {
            mutate();
            mutateAdditional?.();
          }}
          phase={phase}
          experiment={experiment}
          dimension={dimension}
          setError={(error) => setRefreshError(error ?? "")}
          useRadixButton={true}
          radixVariant="outline"
        />
      ) : shouldRenderSafeRolloutButton ? (
        <SafeRolloutRefreshSnapshotButton
          mutate={mutate}
          safeRollout={safeRollout}
        />
      ) : null}
    </>
  );
}
