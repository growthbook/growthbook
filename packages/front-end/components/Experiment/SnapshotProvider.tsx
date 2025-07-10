import React, { useState, ReactNode, useContext } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";

const snapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis | undefined;
  latestAnalysis?: ExperimentSnapshotAnalysis | undefined;
  latest?: ExperimentSnapshotInterface;
  dimensionless?: ExperimentSnapshotInterface;
  mutateSnapshot: () => void;
  phase: number;
  dimension: string;
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null;
  setPhase: (phase: number) => void;
  setDimension: (dimension: string) => void;
  setAnalysisSettings: (
    analysisSettings: ExperimentSnapshotAnalysisSettings | null
  ) => void;
  setSnapshotType: (snapshotType: SnapshotType | undefined) => void;
  loading?: boolean;
  error?: Error;
}>({
  phase: 0,
  dimension: "",
  setPhase: () => {
    // do nothing
  },
  setDimension: () => {
    // do nothing
  },
  setAnalysisSettings: () => {
    // do nothing
  },
  setSnapshotType: () => {
    // do nothing
  },
  mutateSnapshot: () => {
    // do nothing
  },
});

export default function SnapshotProvider({
  experiment,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState(experiment.phases?.length - 1 || 0);
  const [dimension, setDimension] = useState("");
  const [snapshotType, setSnapshotType] = useState<SnapshotType | undefined>(
    undefined
  );

  const { data, error, isValidating, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
    dimensionless?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "") +
      (snapshotType ? `?type=${snapshotType}` : "")
  );

  const defaultAnalysisSettings = data?.snapshot
    ? getSnapshotAnalysis(data?.snapshot)?.settings
    : null;
  const [analysisSettings, setAnalysisSettings] = useState(
    defaultAnalysisSettings
  );

  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: data?.snapshot,
        dimensionless: data?.dimensionless ?? data?.snapshot,
        latest: data?.latest,
        analysis: data?.snapshot
          ? (getSnapshotAnalysis(
              data?.snapshot,
              analysisSettings
            ) as ExperimentSnapshotAnalysis) ?? undefined
          : undefined,
        latestAnalysis: data?.latest
          ? (getSnapshotAnalysis(
              data?.latest,
              analysisSettings
            ) as ExperimentSnapshotAnalysis) ?? undefined
          : undefined,
        mutateSnapshot: mutate,
        phase,
        dimension,
        analysisSettings,
        setPhase,
        setDimension,
        setAnalysisSettings,
        setSnapshotType,
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
