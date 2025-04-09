import React, { useState, ReactNode, useContext } from "react";
import { ExperimentSnapshotAnalysisSettings } from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import {
  FeatureInterface,
  SafeRolloutRule,
} from "back-end/src/validators/features";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import useApi from "@/hooks/useApi";

const snapshotContext = React.createContext<{
  safeRollout?: SafeRolloutRule;
  feature?: FeatureInterface;
  snapshot?: SafeRolloutSnapshotInterface;
  analysis?: SafeRolloutSnapshotAnalysis | undefined;
  latestAnalysis?: SafeRolloutSnapshotAnalysis | undefined;
  latest?: SafeRolloutSnapshotInterface;
  mutateSnapshot: () => void;
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null;
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
  safeRollout: SafeRolloutRule;
  feature: FeatureInterface;
  children: ReactNode;
}) {
  const { data, error, isValidating, mutate } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    latest?: SafeRolloutSnapshotInterface;
  }>(`/safe-rollout/${safeRollout.id}/snapshot`);

  const defaultAnalysisSettings = data?.snapshot
    ? getSnapshotAnalysis(data?.snapshot)?.settings
    : null;

  return (
    <snapshotContext.Provider
      value={{
        safeRollout,
        feature,
        snapshot: data?.snapshot,
        latest: data?.latest,
        analysis: data?.snapshot
          ? getSnapshotAnalysis(data?.snapshot, defaultAnalysisSettings) ??
            undefined
          : undefined,
        latestAnalysis: data?.latest
          ? getSnapshotAnalysis(data?.latest, defaultAnalysisSettings) ??
            undefined
          : undefined,
        mutateSnapshot: mutate,
        analysisSettings: defaultAnalysisSettings,
        error,
        loading: isValidating,
      }}
    >
      {children}
    </snapshotContext.Provider>
  );
}

export function useSnapshot() {
  return useContext(snapshotContext);
}
