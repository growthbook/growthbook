import React from "react";
import { Queries } from "shared/types/query";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import { SafeRolloutInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
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
  onSubmitSuccess?: (snapshot: T) => void;
  mutate: () => void;
  mutateAdditional?: () => void;
  setRefreshError: (error: string) => void;
  // Experiment/holdout-specific props
  experiment?: ExperimentInterfaceStringDates;
  phase?: number;
  dimension?: string;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  resetAnalysisSettingsOnUpdate?: () => void;
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
  onSubmitSuccess,
  mutate,
  mutateAdditional,
  setRefreshError,
  experiment,
  phase,
  dimension,
  resetAnalysisSettingsOnUpdate,
  safeRollout,
}: RefreshResultsButtonProps<T>) {
  const { apiCall } = useAuth();

  const hasQueries = latest?.queries && latest.queries.length > 0;

  // Determine which button to render
  const shouldUseRunQueriesButton = datasourceId && latest && hasQueries;

  const shouldRenderExperimentButton =
    !shouldUseRunQueriesButton &&
    (entityType === "experiment" || entityType === "holdout") &&
    experiment &&
    phase !== undefined &&
    resetAnalysisSettingsOnUpdate;

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
            const body =
              entityType === "experiment" || entityType === "holdout"
                ? JSON.stringify({
                    phase: phase ?? 0,
                    dimension: dimension ?? "",
                  })
                : undefined;

            await apiCall<{ snapshot: T }>(snapshotEndpoint, {
              method: "POST",
              ...(body && { body }),
            })
              .then((res) => {
                onSubmitSuccess?.(res.snapshot);
                mutate();
                mutateAdditional?.();
                setRefreshError("");
              })
              .catch((e) => {
                setRefreshError(e.message);
              });
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
          resetAnalysisSettingsOnUpdate={resetAnalysisSettingsOnUpdate}
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
