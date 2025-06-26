import React, { ReactNode, useContext } from "react";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  DashboardBlockData,
  DashboardBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { isDashboardBlockWithSnapshot } from "shared/enterprise";
import useApi from "@/hooks/useApi";

const DashboardSnapshotContext = React.createContext<{
  defaultSnapshot?: ExperimentSnapshotInterface;
  mutateSnapshot: () => Promise<unknown>;
  loading?: boolean;
  error?: Error;
}>({
  mutateSnapshot: async () => {},
});

export default function DashboardSnapshotProvider({
  experiment,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  children: ReactNode;
}) {
  const {
    data: snapshotData,
    error: snapshotError,
    isValidating: snapshotIsValidating,
    mutate: snapshotMutate,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${
      experiment.phases?.length - 1 || 0
    }`
  );

  return (
    <DashboardSnapshotContext.Provider
      value={{
        defaultSnapshot: snapshotData?.snapshot,
        mutateSnapshot: async () => {
          snapshotMutate();
        },
        error: snapshotError,
        loading: snapshotIsValidating,
      }}
    >
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(
  block: DashboardBlockData<DashboardBlockInterface>
) {
  const {
    defaultSnapshot,
    loading: defaultLoading,
    error: defaultError,
    mutateSnapshot: mutateDefault,
  } = useContext(DashboardSnapshotContext);

  const blockSnapshotId = isDashboardBlockWithSnapshot(block)
    ? block.snapshotId
    : "";

  const shouldRun = () => !!blockSnapshotId;

  const {
    data: blockSnapshotData,
    isValidating: snapshotLoading,
    error: snapshotError,
    mutate,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
  }>(`/snapshots/${blockSnapshotId}`, {
    shouldRun,
  });

  const snapshot = shouldRun() ? blockSnapshotData?.snapshot : defaultSnapshot;
  const loading = shouldRun() ? snapshotLoading : defaultLoading;
  const error = shouldRun() ? snapshotError : defaultError;
  const mutateSnapshot = shouldRun() ? mutate : mutateDefault;
  return {
    snapshot,
    analysis: snapshot?.analyses?.[0],
    analysisSettings: snapshot?.analyses?.[0]?.settings,
    loading,
    error,
    mutateSnapshot,
  };
}
