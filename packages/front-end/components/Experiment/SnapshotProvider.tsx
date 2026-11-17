import React, { useState, ReactNode, useContext, useCallback } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import {
  getExperimentSourceSnapshotRef,
  SourceSnapshotRef,
} from "shared/enterprise";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import {
  useCoherentLatest,
  useRefetchHeavyOnStatusSuccess,
} from "@/hooks/useCoherentSnapshotStatus";

const snapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis | undefined;
  dimensionless?: ExperimentSnapshotInterface;

  latestSummary?: SnapshotStatusSummary;
  // Refreshes the snapshot data exposed by this provider.
  //
  // Default (no options) refreshes only the cheap status endpoint. The
  // provider then auto-upgrades the heavy snapshot fetch when status
  // reports a newer successful snapshot id. This is the right choice for
  // poll loops and for any mutation that creates a new snapshot (POST
  // `/snapshot`, force refresh, bandit refresh, etc.).
  //
  // Pass `{ inPlace: true }` only when the mutation alters the **current**
  // snapshot without changing its id (e.g., appending an analysis to the
  // existing snapshot). The auto-upgrade keys on id changes, so an in-place
  // edit needs an explicit heavy refetch — otherwise consumers will see
  // stale analyses until the next unrelated update.
  mutate: (opts?: { inPlace?: boolean }) => Promise<unknown>;
  phase: number;
  dimension: string;
  precomputedDimensions: string[];
  precomputedUnitDimensionIds: string[];
  analysisSettings?: ExperimentSnapshotAnalysisSettings | null;
  setPhase: (phase: number) => void;
  setDimension: (dimension: string) => void;
  setAnalysisSettings: (
    analysisSettings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  setSnapshotType: (snapshotType: SnapshotType | undefined) => void;
  sourceSnapshot?: SourceSnapshotRef;
  loading?: boolean;
  error?: Error;
}>({
  phase: 0,
  dimension: "",
  precomputedDimensions: [],
  precomputedUnitDimensionIds: [],
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
  mutate: () => Promise.resolve(),
});

export function getSnapshotSummaryPath({
  experimentId,
  phase,
  dimension,
  snapshotType,
}: {
  experimentId: string;
  phase: number;
  dimension: string;
  snapshotType?: SnapshotType;
}): string {
  const query = new URLSearchParams({
    ...(dimension && { dimension }),
    ...(snapshotType && { type: snapshotType }),
  }).toString();
  return (
    `/experiment/${experimentId}/snapshot-summary/${phase}` +
    (query ? `?${query}` : "")
  );
}

export function getPrecomputedDimensions(
  snapshot: ExperimentSnapshotInterface | undefined,
  dimensionless: ExperimentSnapshotInterface | undefined,
): string[] {
  if (snapshot?.type === "standard" && !snapshot?.dimension) {
    return snapshot.settings.dimensions.map((d) => d.id) ?? [];
  }

  // if snapshot is not the latest standard, then show dimensions from
  // the dimensionless snapshot
  if (snapshot?.type !== "standard" && dimensionless?.type === "standard") {
    return dimensionless.settings.dimensions.map((d) => d.id) ?? [];
  }

  return [];
}

export function getPrecomputedUnitDimensionIds(
  experiment: ExperimentInterfaceStringDates | undefined,
  snapshot: ExperimentSnapshotInterface | undefined,
  dimensionless: ExperimentSnapshotInterface | undefined,
): string[] {
  const getSnapshotUnitDimensionIds = (
    snapshot: ExperimentSnapshotInterface,
  ) => {
    const experimentUnitDimensionIds = experiment?.precomputedUnitDimensionIds;
    const snapshotUnitDimensionIds =
      snapshot.settings.precomputedUnitDimensionIds ?? [];

    return experimentUnitDimensionIds
      ? snapshotUnitDimensionIds.filter((id) =>
          experimentUnitDimensionIds.includes(id),
        )
      : snapshotUnitDimensionIds;
  };

  if (snapshot?.type === "standard" && !snapshot?.dimension) {
    return getSnapshotUnitDimensionIds(snapshot);
  }

  // if snapshot is not the latest standard, then show dimensions from
  // the dimensionless snapshot
  if (snapshot?.type !== "standard" && dimensionless?.type === "standard") {
    return getSnapshotUnitDimensionIds(dimensionless);
  }

  return [];
}

function heavyReflectsStatus(
  statusLatest: SnapshotStatusSummary | undefined,
  snapshotId: string | undefined,
): boolean {
  return !!statusLatest && statusLatest.id === snapshotId;
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

  // The heavy snapshot fetch opts out of focus/reconnect revalidation. The
  // cheap status fetch below still revalidates on focus/reconnect and is the
  // signal the provider uses to decide when a new heavy refetch is warranted
  // (see the transition effect after the status fetch).
  const {
    data,
    error,
    isValidating,
    mutate: mutateHeavy,
  } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    dimensionless?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + encodeURIComponent(dimension) : "") +
      (snapshotType ? `?type=${snapshotType}` : ""),
    { autoRevalidate: false },
  );

  // `latest` is sourced from a dedicated status endpoint that skips loading
  // and decoding the per-metric analysis chunks. Keyed by the same
  // phase/dimension/type tuple as the main snapshot fetch.
  const { data: statusData, mutate: mutateStatus } = useApi<{
    latest: SnapshotStatusSummary | null;
  }>(
    getSnapshotSummaryPath({
      experimentId: experiment.id,
      phase,
      dimension,
      snapshotType,
    }),
  );

  const mutate = useCallback(
    async (opts?: { inPlace?: boolean }) => {
      if (opts?.inPlace) {
        await Promise.all([mutateHeavy(), mutateStatus()]);
      } else {
        await mutateStatus();
      }
    },
    [mutateHeavy, mutateStatus],
  );

  const statusLatest = statusData?.latest ?? undefined;
  const snapshotId = data?.snapshot?.id;
  const heavyCaughtUp = heavyReflectsStatus(statusLatest, snapshotId);
  useRefetchHeavyOnStatusSuccess(
    statusLatest,
    heavyCaughtUp,
    isValidating,
    mutateHeavy,
  );
  const latest = useCoherentLatest(statusLatest, heavyCaughtUp) ?? undefined;

  const defaultAnalysisSettings = data?.snapshot
    ? getSnapshotAnalysis(data?.snapshot)?.settings
    : null;
  const [analysisSettings, setAnalysisSettings] = useState(
    defaultAnalysisSettings,
  );

  const dimensionlessSnapshot = data?.dimensionless ?? data?.snapshot;
  const precomputedUnitDimensionIds = getPrecomputedUnitDimensionIds(
    experiment,
    data?.snapshot,
    dimensionlessSnapshot,
  );
  const sourceSnapshot = getExperimentSourceSnapshotRef(data?.snapshot);

  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: data?.snapshot,
        dimensionless: dimensionlessSnapshot,
        latestSummary: latest,
        analysis: data?.snapshot
          ? ((getSnapshotAnalysis(
              data?.snapshot,
              analysisSettings,
            ) as ExperimentSnapshotAnalysis) ?? undefined)
          : undefined,
        mutate,
        phase,
        dimension,
        analysisSettings,
        precomputedDimensions: getPrecomputedDimensions(
          data?.snapshot,
          dimensionlessSnapshot,
        ),
        precomputedUnitDimensionIds,
        sourceSnapshot,
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

export interface LocalSnapshotProviderProps {
  experiment?: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  phase: number;
  dimension: string;
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

  const [localSnapshot, setLocalSnapshot] =
    useState<ExperimentSnapshotInterface>(initialSnapshot);
  const [loading, setLoading] = useState(false);

  // Initialize analysis settings from parent's settings if provided,
  // otherwise fall back to the snapshot's default analysis
  const defaultAnalysisSettings = initialSnapshot
    ? (getSnapshotAnalysis(initialSnapshot)?.settings ?? null)
    : null;

  // Only use parentAnalysisSettings if it matches an existing analysis
  // Otherwise fall back to default settings
  const validParentSettings =
    parentAnalysisSettings && initialSnapshot
      ? getSnapshotAnalysis(initialSnapshot, parentAnalysisSettings)
        ? parentAnalysisSettings
        : null
      : null;

  const [analysisSettings, setAnalysisSettings] =
    useState<ExperimentSnapshotAnalysisSettings | null>(
      validParentSettings ?? defaultAnalysisSettings,
    );

  // Refresh by snapshot id (not by experiment+phase) so this works for both
  // experiments and reports. Reports have their own specific snapshot which
  // may differ from the experiment's current latest snapshot, and we want to
  // pick up newly-added analyses on this exact snapshot.
  const snapshotId = localSnapshot.id;
  // LocalSnapshotProvider has no separate status fetch — a single
  // by-id GET refreshes everything. The unified `mutate` ignores the
  // `inPlace` flag here because there's nothing else to refetch.
  const mutate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiCall<{
        snapshot: ExperimentSnapshotInterface;
      }>(`/snapshot/${snapshotId}`);
      if (response.snapshot) {
        setLocalSnapshot(response.snapshot);
      }
    } finally {
      setLoading(false);
    }
  }, [apiCall, snapshotId]);

  // Compute analysis from local snapshot + local settings
  const analysis = localSnapshot
    ? (getSnapshotAnalysis(localSnapshot, analysisSettings) ?? undefined)
    : undefined;

  return (
    <snapshotContext.Provider
      value={{
        experiment,
        snapshot: localSnapshot,
        dimensionless: localSnapshot,
        latestSummary: localSnapshot,
        analysis,
        mutate,
        phase,
        dimension,
        analysisSettings,
        setAnalysisSettings,
        precomputedDimensions: getPrecomputedDimensions(
          localSnapshot,
          localSnapshot,
        ),
        precomputedUnitDimensionIds: getPrecomputedUnitDimensionIds(
          experiment,
          localSnapshot,
          localSnapshot,
        ),
        setPhase: () => {
          // phase is fixed
        },
        setDimension: () => {
          // dimension is fixed
        },
        setSnapshotType: () => {
          // do nothing
        },
        loading,
      }}
    >
      {children}
    </snapshotContext.Provider>
  );
}
