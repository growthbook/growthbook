import React, {
  useState,
  ReactNode,
  useContext,
  useCallback,
  useEffect,
} from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  SnapshotType,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotStatusSummary,
} from "shared/types/experiment-snapshot";
import { getSnapshotAnalysis } from "shared/util";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

const snapshotContext = React.createContext<{
  experiment?: ExperimentInterfaceStringDates;
  snapshot?: ExperimentSnapshotInterface;
  analysis?: ExperimentSnapshotAnalysis | undefined;
  latest?: SnapshotStatusSummary;
  dimensionless?: ExperimentSnapshotInterface;
  // Refreshes both fetches. Use when the operation mutates fields on the
  // current snapshot in place without changing its id (e.g., appending an
  // analysis). For operations that create a new snapshot, prefer
  // mutateLatest and let the provider auto-upgrade.
  mutateSnapshot: () => Promise<unknown>;
  // Refreshes only the cheap status fetch. Use for poll loops; the provider
  // automatically refreshes the heavy snapshot when status indicates a
  // newer successful snapshot is available.
  mutateLatest: () => Promise<unknown>;
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
  mutateSnapshot: () => Promise.resolve(),
  mutateLatest: () => Promise.resolve(),
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

// When the cheap status endpoint reports a newer successful snapshot than the
// one currently held by the heavy fetch, pull the fresh analyses exactly
// once. This is what lets poll loops use a status-only mutator: the provider
// handles upgrading to the full snapshot on completion, on background
// completion seen via focus revalidation, etc. The single id-mismatch check
// covers both "no heavy snapshot yet" (undefined !== id) and "heavy is behind
// a newer successful run" (X !== Y).
function useRefetchHeavyOnStatusSuccess(
  statusLatest: SnapshotStatusSummary | undefined,
  snapshotId: string | undefined,
  refetchHeavy: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (statusLatest?.status !== "success") return;
    if (statusLatest.id !== snapshotId) void refetchHeavy();
  }, [statusLatest?.id, statusLatest?.status, snapshotId, refetchHeavy]);
}

// Surfaces the status endpoint's view atomically with the heavy snapshot.
// While the status endpoint reports a newer successful snapshot than the
// heavy fetch has caught up to, hold back the visible value so consumers
// don't see "queries done" alongside stale analyses for the duration of the
// heavy refetch. Running / errored / progress updates pass through
// immediately — only the final success flip is gated on heavy-fetch
// agreement. Trade-off: completion indicators (e.g. "Running…") stay up for
// the extra ~1-3s of the heavy fetch, in exchange for an atomic results
// transition.
function useCoherentLatest(
  statusLatest: SnapshotStatusSummary | undefined,
  snapshotId: string | undefined,
): SnapshotStatusSummary | undefined {
  const heavyAgrees =
    !statusLatest ||
    statusLatest.status !== "success" ||
    statusLatest.id === snapshotId;
  const [held, setHeld] = useState<SnapshotStatusSummary | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!heavyAgrees) return;
    // Bail out when only the SWR reference changed (id + status are what the
    // gate keys on; equal id + status means the held value is interchangeable
    // with the live one and we'd just be triggering an extra re-render).
    setHeld((prev) =>
      prev?.id === statusLatest?.id && prev?.status === statusLatest?.status
        ? prev
        : statusLatest,
    );
  }, [heavyAgrees, statusLatest]);
  return heavyAgrees ? statusLatest : held;
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
  const { data, error, isValidating, mutate } = useApi<{
    snapshot: ExperimentSnapshotInterface;
    dimensionless?: ExperimentSnapshotInterface;
  }>(
    `/experiment/${experiment.id}/snapshot/${phase}` +
      (dimension ? "/" + dimension : "") +
      (snapshotType ? `?type=${snapshotType}` : ""),
    { autoRevalidate: false },
  );

  // `latest` is sourced from a dedicated status endpoint that skips loading
  // and decoding the per-metric analysis chunks. Keyed by the same
  // phase/dimension/type tuple as the main snapshot fetch.
  const statusQuery = [
    dimension ? `dimension=${encodeURIComponent(dimension)}` : "",
    snapshotType ? `type=${snapshotType}` : "",
  ]
    .filter(Boolean)
    .join("&");
  const { data: statusData, mutate: mutateStatus } = useApi<{
    latest: SnapshotStatusSummary | null;
  }>(
    `/experiment/${experiment.id}/snapshot-status/${phase}` +
      (statusQuery ? `?${statusQuery}` : ""),
  );

  const mutateSnapshot = useCallback(async () => {
    await Promise.all([mutate(), mutateStatus()]);
  }, [mutate, mutateStatus]);

  const mutateLatest = useCallback(async () => {
    await mutateStatus();
  }, [mutateStatus]);

  const statusLatest = statusData?.latest ?? undefined;
  const snapshotId = data?.snapshot?.id;
  useRefetchHeavyOnStatusSuccess(statusLatest, snapshotId, mutate);
  const latest = useCoherentLatest(statusLatest, snapshotId);

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
        latest,
        analysis: data?.snapshot
          ? ((getSnapshotAnalysis(
              data?.snapshot,
              analysisSettings,
            ) as ExperimentSnapshotAnalysis) ?? undefined)
          : undefined,
        mutateSnapshot,
        mutateLatest,
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
  const mutateSnapshot = useCallback(async () => {
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
        latest: localSnapshot,
        analysis,
        mutateSnapshot,
        // LocalSnapshotProvider has no separate status fetch — there's a
        // single snapshot fetched by id. Status refreshes are equivalent to
        // a full refresh here.
        mutateLatest: mutateSnapshot,
        phase,
        dimension,
        analysisSettings,
        setAnalysisSettings,
        precomputedDimensions: getPrecomputedDimensions(
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
