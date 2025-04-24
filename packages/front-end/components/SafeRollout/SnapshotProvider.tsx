import React, { ReactNode, useContext } from "react";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotAnalysisSettings,
  SafeRolloutSnapshotInterface,
} from "back-end/types/safe-rollout";
import { getSafeRolloutSnapshotAnalysis } from "shared/util";
import { FeatureInterface } from "back-end/src/validators/features";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import useApi from "@/hooks/useApi";

const snapshotContext = React.createContext<{
  safeRollout?: SafeRolloutInterface;
  feature?: FeatureInterface;
  snapshot?: SafeRolloutSnapshotInterface;
  analysis?: SafeRolloutSnapshotAnalysis | undefined;
  latestAnalysis?: SafeRolloutSnapshotAnalysis | undefined;
  latest?: SafeRolloutSnapshotInterface;
  mutateSnapshot: () => void;
  analysisSettings?: SafeRolloutSnapshotAnalysisSettings | null;
  loading?: boolean;
  error?: Error;
}>({
  mutateSnapshot: () => {
    // do nothing
  },
});

export default function SafeRolloutSnapshotProvider({
  safeRollout,
  feature,
  children,
}: {
  safeRollout: SafeRolloutInterface;
  feature: FeatureInterface;
  children: ReactNode;
}) {
  const { data, error, mutate, isLoading } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>(`/safe-rollout/${safeRollout.id}/snapshot`);

  const defaultAnalysisSettings = data?.snapshot
    ? getSafeRolloutSnapshotAnalysis(data?.snapshot)?.settings
    : null;

  return (
    <snapshotContext.Provider
      value={{
        safeRollout,
        feature,
        snapshot: data?.snapshot,
        latest: data?.latest,
        analysis: data?.snapshot
          ? getSafeRolloutSnapshotAnalysis(
              data?.snapshot,
              defaultAnalysisSettings
            ) ?? undefined
          : undefined,
        latestAnalysis: data?.latest
          ? getSafeRolloutSnapshotAnalysis(
              data?.latest,
              defaultAnalysisSettings
            ) ?? undefined
          : undefined,
        mutateSnapshot: mutate,
        analysisSettings: defaultAnalysisSettings,
        error,
        loading: isLoading,
      }}
    >
      {children}
    </snapshotContext.Provider>
  );
}

export function useSafeRolloutSnapshot() {
  return useContext(snapshotContext);
}
