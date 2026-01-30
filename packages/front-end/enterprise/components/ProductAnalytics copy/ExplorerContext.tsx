import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import isEqual from "lodash/isEqual";
import {
  ExploreState,
  ExploreSeries,
  ExploreSeriesType,
  ExploreQueryResponse,
} from "shared/enterprise";
import { createNewSeries, getSeriesTag, SERIES_COLORS } from "./util";
import { useExploreData } from "./useExploreData";

/** Re-assign color and tag to each series by index so order is consistent and there are no gaps. */
function assignSeriesColorsAndTags(series: ExploreSeries[]): ExploreSeries[] {
  return series.map((s, index) => ({
    ...s,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    tag: getSeriesTag(index),
  }));
}

const INITIAL_EXPLORE_STATE: ExploreState = {
  series: [],
  visualizationType: "timeseries",
  lookbackDays: 30,
  granularity: "day",
  globalRowFilters: [],
  groupBy: [],
};

export interface ExplorerContextValue {
  // ─── State ─────────────────────────────────────────────────────────────
  draftExploreState: ExploreState;
  submittedExploreState: ExploreState;
  selectedSeriesId: string | null;
  hasPendingChanges: boolean;
  exploreData: ExploreQueryResponse | null;
  loading: boolean;
  exploreError: Error | null;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: React.Dispatch<React.SetStateAction<ExploreState>>;
  setSubmittedExploreState: React.Dispatch<
    React.SetStateAction<ExploreState>
  >;
  setSelectedSeriesId: (id: string | null) => void;
  handleUpdateGraph: () => Promise<void>;
  handleAddSeries: (type: ExploreSeriesType) => void;
  handleUpdateSeries: (id: string, updates: Partial<ExploreSeries>) => void;
  handleDeleteSeries: (id: string) => void;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export function ExplorerProvider({ children }: { children: ReactNode }) {
  const { data: exploreData, loading, error: exploreError, fetchData } =
    useExploreData();

  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [draftExploreState, setDraftExploreState] =
    useState<ExploreState>(INITIAL_EXPLORE_STATE);
  const [submittedExploreState, setSubmittedExploreState] =
    useState<ExploreState>(INITIAL_EXPLORE_STATE);

  const hasPendingChanges = useMemo(
    () => !isEqual(draftExploreState, submittedExploreState),
    [draftExploreState, submittedExploreState],
  );

  const handleUpdateGraph = useCallback(async () => {
    await fetchData(draftExploreState);
    setSubmittedExploreState(draftExploreState);
  }, [draftExploreState, fetchData]);

  const handleAddSeries = useCallback(
    (type: ExploreSeriesType) => {
      const newSeries = createNewSeries(type);
      setDraftExploreState((prev) => {
        const nextSeries = assignSeriesColorsAndTags([
          ...prev.series,
          newSeries,
        ]);
        return { ...prev, series: nextSeries };
      });
      setSelectedSeriesId(newSeries.id);
    },
    [],
  );

  const handleUpdateSeries = useCallback(
    (id: string, updates: Partial<ExploreSeries>) => {
      setDraftExploreState((prev) => ({
        ...prev,
        series: prev.series.map((s) =>
          s.id === id ? { ...s, ...updates } : s,
        ),
      }));
    },
    [],
  );

  const handleDeleteSeries = useCallback((id: string) => {
    setDraftExploreState((prev) => {
      const remaining = prev.series.filter((s) => s.id !== id);
      const nextSeries = assignSeriesColorsAndTags(remaining);
      setSelectedSeriesId((current) =>
        current === id ? (nextSeries.length > 0 ? nextSeries[0].id : null) : current,
      );
      return { ...prev, series: nextSeries };
    });
  }, []);

  const value = useMemo<ExplorerContextValue>(
    () => ({
      draftExploreState,
      submittedExploreState,
      selectedSeriesId,
      hasPendingChanges,
      exploreData,
      loading,
      exploreError,
      setDraftExploreState,
      setSubmittedExploreState,
      setSelectedSeriesId,
      handleUpdateGraph,
      handleAddSeries,
      handleUpdateSeries,
      handleDeleteSeries,
    }),
    [
      draftExploreState,
      submittedExploreState,
      selectedSeriesId,
      hasPendingChanges,
      exploreData,
      loading,
      exploreError,
      handleUpdateGraph,
      handleAddSeries,
      handleUpdateSeries,
      handleDeleteSeries,
    ],
  );

  return (
    <ExplorerContext.Provider value={value}>
      {children}
    </ExplorerContext.Provider>
  );
}

export function useExplorerContext(): ExplorerContextValue {
  const ctx = useContext(ExplorerContext);
  if (!ctx) {
    throw new Error(
      "useExplorerContext must be used within an ExplorerProvider",
    );
  }
  return ctx;
}
