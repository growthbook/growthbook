import React, { useState, ReactNode, useContext } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment-snapshot";
import { getSnapshotAnalysis } from "@/../shared/util";
import useApi from "@/hooks/useApi";

const snapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis | undefined;
  latestAnalysis?: ExperimentSnapshotAnalysis | undefined;
  latest?: ExperimentSnapshotInterface;
  mutateSnapshot: () => void;
  phase: number;
  dimension: string;
  baselineVariation: string;
  analysisSettings?: ExperimentSnapshotAnalysisSettings | undefined;
  setPhase: (phase: number) => void;
  setDimension: (dimension: string) => void;
  setBaselineVariation: (baselineVariation: string) => void;
  setAnalysisSettings: (analysisSettings: ExperimentSnapshotAnalysisSettings) => void;
  error?: Error;
}>({
  phase: 0,
  dimension: "",
  baselineVariation: "0",
  setPhase: () => {
    // do nothing
  },
  setDimension: () => {
    // do nothing
  },
  setBaselineVariation: () => {
    // do nothing
  },
  setAnalysisSettings: () => {
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
  const [baselineVariation, setBaselineVariation] = useState(experiment.variations[0].name)

  const { data, error, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "")
  );

  const defaultSnapshotSettings =  data?.snapshot ? getSnapshotAnalysis(data?.snapshot)?.settings : undefined;
  const [analysisSettings, setAnalysisSettings] = useState(defaultSnapshotSettings);
  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: data?.snapshot,
        latest: data?.latest,
        analysis: data?.snapshot
          ? getSnapshotAnalysis(data?.snapshot, analysisSettings) ?? undefined
          : undefined,
        latestAnalysis: data?.latest
          ? getSnapshotAnalysis(data?.latest, analysisSettings) ?? undefined
          : undefined,
        mutateSnapshot: mutate,
        phase,
        dimension,
        baselineVariation,
        analysisSettings,
        setPhase,
        setDimension,
        setBaselineVariation,
        setAnalysisSettings,
        error,
      }}
    >
      {children}
    </snapshotContext.Provider>
  );
}

export function useSnapshot() {
  return useContext(snapshotContext);
}
