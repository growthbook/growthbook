import React from "react";
import { Queries } from "shared/types/query";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";
import {
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";
import ExperimentRefreshSnapshotButton from "@/components/Experiment/RefreshSnapshotButton";
import SafeRolloutRefreshSnapshotButton from "@/components/SafeRollout/RefreshSnapshotButton";
import { useExperimentSnapshotUpdate } from "@/hooks/useExperimentSnapshotUpdate";

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
  // Return false to abort the refresh (e.g. to open a confirmation dialog
  // instead). Mirrors Modal's customValidation. Side effects are allowed.
  customValidation?: () => boolean | Promise<boolean>;
  // Experiment/holdout-specific props
  experiment?: ExperimentInterfaceStringDates;
  phase?: number;
  dimension?: string;
  setAnalysisSettings?: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
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
  customValidation,
  experiment,
  phase,
  dimension,
  safeRollout,
}: RefreshResultsButtonProps<T>) {
  const { apiCall } = useAuth();

  const { submitUpdate } = useExperimentSnapshotUpdate({
    experiment,
    phase: phase ?? 0,
    dimension,
    mutate,
    mutateAdditional,
    setRefreshError,
    onSuccess,
    customValidation,
    experimentSnapshotTrackingProps,
  });

  const hasQueries = latest?.queries && latest.queries.length > 0;
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

  const cancelEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/snapshot/${latest?.id}/cancel`
      : `/snapshot/${latest?.id}/cancel`;

  const snapshotEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/${entityId}/snapshot`
      : `/experiment/${entityId}/snapshot`;

  const runSafeRolloutUpdate = async () => {
    if (!latest) return;
    try {
      await apiCall<{ snapshot: SafeRolloutSnapshotInterface }>(
        snapshotEndpoint,
        { method: "POST" },
      );
      onSuccess?.();
      setRefreshError("");
    } catch (e) {
      setRefreshError(e.message);
    } finally {
      mutate();
      mutateAdditional?.();
    }
  };

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
          onSubmit={
            entityType === "safe-rollout" ? runSafeRolloutUpdate : submitUpdate
          }
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
          customValidation={customValidation}
          onSuccess={onSuccess}
          experimentSnapshotTrackingProps={experimentSnapshotTrackingProps}
        />
      ) : shouldRenderSafeRolloutButton ? (
        <SafeRolloutRefreshSnapshotButton
          mutate={mutate}
          safeRollout={safeRollout}
          customValidation={customValidation}
        />
      ) : null}
    </>
  );
}
