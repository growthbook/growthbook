import React, { ReactElement } from "react";
import { Queries } from "back-end/types/query";
import { useAuth } from "@/services/auth";
import RunQueriesButton from "@/components/Queries/RunQueriesButton";

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
  resetFilters?: () => void | Promise<void>;
  refreshButton: ReactElement;
  debugLabel?: string;
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
  resetFilters,
  refreshButton,
  debugLabel = "Entity",
}: RefreshResultsButtonProps<T>) {
  const { apiCall } = useAuth();

  const hasQueries = latest?.queries && latest.queries.length > 0;

  // Construct endpoints based on entity type
  const cancelEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/snapshot/${latest?.id}/cancel`
      : `/snapshot/${latest?.id}/cancel`;

  const snapshotEndpoint =
    entityType === "safe-rollout"
      ? `/safe-rollout/${entityId}/snapshot`
      : `/experiment/${entityId}/snapshot`;

  if (datasourceId && latest && hasQueries) {
    return (
      <>
        <div>
          {debugLabel} Datasource: {datasourceId}
        </div>
        <div>Latest Snapshot: {latest?.id}</div>
        <div>Latest Snapshot Queries: {latest?.queries?.length}</div>
        <div>Run Queries Button</div>
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
          color="outline-primary"
          resetFilters={resetFilters}
          onSubmit={async () => {
            await apiCall<{ snapshot: T }>(snapshotEndpoint, {
              method: "POST",
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
      </>
    );
  }

  return (
    <>
      <div>
        {debugLabel} Datasource: {datasourceId}
      </div>
      <div>Latest Snapshot: {latest?.id}</div>
      <div>Latest Snapshot Queries: {latest?.queries?.length}</div>
      <div>Refresh Snapshot Button</div>
      {refreshButton}
    </>
  );
}
