import React, { useState, ReactNode, useContext } from "react";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";
import { SafeRolloutRule } from "back-end/src/validators/features";
import { SafeRolloutSnapshotInterface } from "back-end/src/validators/safe-rollout";

const snapshotContext = React.createContext<{
  safeRollout?: SafeRolloutRule;
  snapshot?: SafeRolloutSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis | undefined;
  //   latestAnalysis?: ExperimentSnapshotAnalysis | undefined;
  //   latest?: ExperimentSnapshotInterface;
  //   dimensionless?: ExperimentSnapshotInterface;
  mutateSnapshot: () => void;
  dimension: string;
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null;
  setDimension: (dimension: string) => void;
  loading?: boolean;
  error?: Error;
}>({
  dimension: "",
  setDimension: () => {
    // do nothing
  },
  mutateSnapshot: () => {
    // do nothing
  },
});

export default function SafeRolloutSnapshotProvider({
  safeRollout,
  children,
}: {
  safeRollout: SafeRolloutRule;
  children: ReactNode;
}) {
  const [dimension, setDimension] = useState("");

  const { data, error, isValidating, mutate } = useApi<{
    snapshot: SafeRolloutSnapshotInterface;
    // latest?: ExperimentSnapshotInterface;
    // dimensionless?: ExperimentSnapshotInterface;
  }>(`/safe-rollout/${safeRollout.id}/snapshot`);

  const defaultAnalysisSettings = data?.snapshot
    ? getSnapshotAnalysis(data?.snapshot)?.settings
    : null;
  const [analysisSettings, setAnalysisSettings] = useState(
    defaultAnalysisSettings
  );
  return (
    <snapshotContext.Provider
      value={{
        safeRollout,
        snapshot: data?.snapshot,
        // dimensionless: data?.dimensionless ?? data?.snapshot,
        // latest: data?.latest,
        analysis: data?.snapshot
          ? getSnapshotAnalysis(data?.snapshot, analysisSettings) ?? undefined
          : undefined,
        // latestAnalysis: data?.latest
        //   ? getSnapshotAnalysis(data?.latest, analysisSettings) ?? undefined
        //   : undefined,
        mutateSnapshot: mutate,
        dimension,
        analysisSettings,
        setDimension,
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
