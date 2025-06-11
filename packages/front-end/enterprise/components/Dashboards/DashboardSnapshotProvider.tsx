import React, { ReactNode, useContext, useMemo } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "@/hooks/useApi";

const DashboardSnapshotContext = React.createContext<{
  defaultSnapshot?: ExperimentSnapshotInterface;
  snapshotMap?: Record<string, ExperimentSnapshotInterface>;
  analysisMap?: Record<string, ExperimentSnapshotAnalysis | undefined>;
  mutateSnapshots: () => Promise<unknown>;
  analysisSettingsMap?: Record<
    string,
    ExperimentSnapshotAnalysisSettings | undefined
  >;
  loading?: boolean;
  error?: Error;
}>({
  mutateSnapshots: async () => {},
});

export default function DashboardSnapshotProvider({
  dashboardId,
  experiment,
  children,
}: {
  dashboardId: string;
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
  const {
    data: dashboardData,
    error: dashboardError,
    isValidating: dashboardIsValidating,
    mutate: dashboardMutate,
  } = useApi<{
    snapshots: Record<string, ExperimentSnapshotInterface>;
  }>(`/dashboards/${dashboardId}/snapshots/`);

  const snapshotEntries = useMemo(
    () =>
      dashboardData?.snapshots ? Object.entries(dashboardData.snapshots) : [],
    [dashboardData]
  );

  const defaultAnalysisSettingsMap = dashboardData?.snapshots
    ? Object.fromEntries(
        snapshotEntries.map(([blockUid, snapshot]) => [
          blockUid,
          getSnapshotAnalysis(snapshot)?.settings,
        ])
      )
    : undefined;

  const analysisMap = useMemo(() => {
    return snapshotEntries
      ? Object.fromEntries(
          snapshotEntries.map(([blockUid, snapshot]) => [
            blockUid,
            (getSnapshotAnalysis(
              snapshot,
              defaultAnalysisSettingsMap?.[blockUid]
            ) as ExperimentSnapshotAnalysis) ?? undefined,
          ])
        )
      : undefined;
  }, [defaultAnalysisSettingsMap, snapshotEntries]);

  return (
    <DashboardSnapshotContext.Provider
      value={{
        defaultSnapshot: snapshotData?.snapshot,
        snapshotMap: dashboardData?.snapshots,
        analysisMap,
        mutateSnapshots: async () => {
          dashboardMutate();
          snapshotMutate();
        },
        error: dashboardError || snapshotError,
        loading: dashboardIsValidating || snapshotIsValidating,
      }}
    >
      {children}
    </DashboardSnapshotContext.Provider>
  );
}

export function useDashboardSnapshot(dashboardBlockUid?: string) {
  const {
    defaultSnapshot,
    snapshotMap,
    analysisMap,
    analysisSettingsMap,
    loading,
    error,
    mutateSnapshots,
  } = useContext(DashboardSnapshotContext);

  if (!dashboardBlockUid) {
    const analysis = defaultSnapshot
      ? getSnapshotAnalysis(defaultSnapshot) || undefined
      : undefined;
    return {
      snapshot: defaultSnapshot,
      analysis,

      analysisSettings: analysis?.settings,
      loading,
      error,
      mutateSnapshot: mutateSnapshots,
    };
  }
  return {
    snapshot: snapshotMap?.[dashboardBlockUid],
    analysis: analysisMap?.[dashboardBlockUid],
    analysisSettings: analysisSettingsMap?.[dashboardBlockUid],
    loading,
    error,
    mutateSnapshot: mutateSnapshots,
  };
}
