import React, { useState, ReactNode, useContext, useCallback } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

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
  precomputedDimensions: string[];
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null;
  setPhase: (phase: number) => void;
  setDimension: (dimension: string) => void;
  setAnalysisSettings: (
    analysisSettings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  setSnapshotType: (snapshotType: SnapshotType | undefined) => void;
  loading?: boolean;
  error?: Error;
}>({
  phase: 0,
  dimension: "",
  precomputedDimensions: [],
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

export function getPrecomputedDimensions(
  snapshot: ExperimentSnapshotInterface | undefined,
  dimensionless: ExperimentSnapshotInterface | undefined,
): string[] {
  if (snapshot?.type === "standard" && !snapshot?.dimension) {
    return snapshot?.settings.dimensions.map((d) => d.id) ?? [];
  }

  // if snapshot is not the latest standard, then show dimensions from
  // the dimensionless snapshot
  if (snapshot?.type !== "standard" && dimensionless?.type === "standard") {
    return dimensionless?.settings.dimensions.map((d) => d.id) ?? [];
  }

  return [];
}

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
    undefined,
  );

  const { data, error, isValidating, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    latest?: ExperimentSnapshotInterface;
    dimensionless?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "") +
      (snapshotType ? `?type=${snapshotType}` : ""),
  );

  const defaultAnalysisSettings = data?.snapshot
    ? getSnapshotAnalysis(data?.snapshot)?.settings
    : null;
  const [analysisSettings, setAnalysisSettings] = useState(
    defaultAnalysisSettings,
  );
  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: data?.snapshot,
        dimensionless: data?.dimensionless ?? data?.snapshot,
        latest: data?.latest,
        analysis: data?.snapshot
          ? ((getSnapshotAnalysis(
              data?.snapshot,
              analysisSettings,
            ) as ExperimentSnapshotAnalysis) ?? undefined)
          : undefined,
        latestAnalysis: data?.latest
          ? ((getSnapshotAnalysis(
              data?.latest,
              analysisSettings,
            ) as ExperimentSnapshotAnalysis) ?? undefined)
          : undefined,
        mutateSnapshot: mutate,
        phase,
        dimension,
        analysisSettings,
        precomputedDimensions: getPrecomputedDimensions(
          data?.snapshot,
          data?.dimensionless,
        ),
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

/**
 * LocalSnapshotProvider provides an isolated snapshot context for components
 * that need to manage their own snapshot state independently from the parent.
 *
 * This is used by MetricDrilldownModal to allow changing baseline/variation
 * settings without affecting the main results table.
 *
 * Components inside this provider will use useSnapshot() and automatically
 * get the local context values instead of the parent's values.
 */
export interface LocalSnapshotProviderProps {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  phase: number;
  dimension: string;
  /** Initial analysis settings to inherit from parent context */
  initialAnalysisSettings?: ExperimentSnapshotAnalysisSettings | null;
  children: ReactNode;
}

export function LocalSnapshotProvider({
  experiment,
  snapshot: initialSnapshot,
  phase,
  dimension,
  initialAnalysisSettings: parentAnalysisSettings,
  children,
}: LocalSnapshotProviderProps) {
  const { apiCall } = useAuth();

  // Local state - initialized from props
  const [localSnapshot, setLocalSnapshot] =
    useState<ExperimentSnapshotInterface>(initialSnapshot);
  const [loading, setLoading] = useState(false);

  // Initialize analysis settings from parent's settings if provided,
  // otherwise fall back to the snapshot's default analysis
  const defaultAnalysisSettings = initialSnapshot
    ? (getSnapshotAnalysis(initialSnapshot)?.settings ?? null)
    : null;
  const [analysisSettings, setAnalysisSettings] =
    useState<ExperimentSnapshotAnalysisSettings | null>(
      parentAnalysisSettings ?? defaultAnalysisSettings,
    );

  // Local mutate function - fetches into local state only, not parent
  const mutateSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiCall<{
        snapshot: ExperimentSnapshotInterface;
      }>(
        `/experiment/${experiment.id}/snapshot/${phase}` +
          (dimension ? "/" + dimension : ""),
      );
      if (response.snapshot) {
        setLocalSnapshot(response.snapshot);
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, experiment.id, phase, dimension]);

  // Compute analysis from local snapshot + local settings
  const analysis = localSnapshot
    ? ((getSnapshotAnalysis(
        localSnapshot,
        analysisSettings,
      ) as ExperimentSnapshotAnalysis) ?? undefined)
    : undefined;

  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: localSnapshot,
        dimensionless: localSnapshot,
        latest: localSnapshot,
        analysis,
        latestAnalysis: analysis,
        mutateSnapshot,
        phase,
        dimension,
        analysisSettings,
        precomputedDimensions: getPrecomputedDimensions(
          localSnapshot,
          localSnapshot,
        ),
        setPhase: () => {
          // No-op for local provider - phase is fixed
        },
        setDimension: () => {
          // No-op for local provider - dimension is fixed
        },
        setAnalysisSettings,
        setSnapshotType: () => {
          // No-op for local provider
        },
        loading,
      }}
    >
      {children}
    </snapshotContext.Provider>
  );
}
