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

// When the cheap status endpoint reports a newer successful snapshot than the
// one currently held by the heavy fetch, pull the fresh analyses exactly
// once. This is what lets poll loops use a status-only mutator: the provider
// handles upgrading to the full snapshot on completion, on background
// completion seen via focus revalidation, etc. The single id-mismatch check
// covers both "no heavy snapshot yet" (undefined !== id) and "heavy is behind
// a newer successful run" (X !== Y). `heavyIsValidating` suppresses the
// initial-mount redundant refetch: on first load the heavy fetch is already
// in flight while the status fetch resolves, and without this guard a status
// response that lands outside SWR's dedup window would trigger a second
// round-trip for a request the provider is already making.
function useRefetchHeavyOnStatusSuccess(
  statusLatest: SnapshotStatusSummary | undefined,
  snapshotId: string | undefined,
  heavyIsValidating: boolean,
  refetchHeavy: () => Promise<unknown>,
): void {
  useEffect(() => {
    if (statusLatest?.status !== "success") return;
    if (heavyIsValidating) return;
    if (statusLatest.id !== snapshotId) void refetchHeavy();
  }, [
    statusLatest?.id,
    statusLatest?.status,
    snapshotId,
    heavyIsValidating,
    refetchHeavy,
  ]);
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
      (dimension ? "/" + dimension : "") +
      (snapshotType ? `?type=${snapshotType}` : ""),
    { autoRevalidate: false },
  );

  // `latest` is sourced from a dedicated status endpoint that skips loading
  // and decoding the per-metric analysis chunks. Keyed by the same
  // phase/dimension/type tuple as the main snapshot fetch.
  const statusQuery = new URLSearchParams({
    ...(dimension && { dimension }),
    ...(snapshotType && { type: snapshotType }),
  }).toString();
  const { data: statusData, mutate: mutateStatus } = useApi<{
    latest: SnapshotStatusSummary | null;
  }>(
    `/experiment/${experiment.id}/snapshot-summary/${phase}` +
      (statusQuery ? `?${statusQuery}` : ""),
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
  useRefetchHeavyOnStatusSuccess(
    statusLatest,
    snapshotId,
    isValidating,
    mutateHeavy,
  );
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
          data?.dimensionless,
        ),
        precomputedUnitDimensionIds: getPrecomputedUnitDimensionIds(
          experiment,
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
