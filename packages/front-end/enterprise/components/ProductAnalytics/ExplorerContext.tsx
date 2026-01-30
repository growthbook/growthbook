import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import isEqual from "lodash/isEqual";
import { assignSeriesColorsAndTags, createEmptyValue, createEmptyDataset } from "./util";
import { useExploreData } from "./useExploreData";
import { DatasetType, ProductAnalyticsConfig, ProductAnalyticsDataset, ProductAnalyticsResult, ProductAnalyticsValue, SqlValue } from "shared/validators";

const INITIAL_EXPLORE_STATE: ProductAnalyticsConfig = {
  dataset: {
    type: "metric", // default to metric
    values: []
  },
  dimensions: [
    {
      dimensionType: "date",
      column: "date",
      dateGranularity: "day",
    },
  ],
  chartType: "line",
  dateRange: {
    predefined: "last30Days",
    lookbackValue: 30,
    lookbackUnit: "day",
    startDate: null,
    endDate: null,
  },
};

export interface ExplorerContextValue {
  // ─── State ─────────────────────────────────────────────────────────────
  draftExploreState: ProductAnalyticsConfig;
  submittedExploreState: ProductAnalyticsConfig | null;
  hasPendingChanges: boolean;
  exploreData: ProductAnalyticsResult | null;
  loading: boolean;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: React.Dispatch<
    React.SetStateAction<ProductAnalyticsConfig>
  >;
  handleSubmit: () => Promise<void>;
  addValueToDataset: (valueType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  clearDataset: () => void;
  changeDatasetType: (type: DatasetType) => void;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);


interface ExplorerProviderProps {
  children: ReactNode;
}

export function ExplorerProvider({ children }: ExplorerProviderProps) {
  const { data, loading, fetchData } =
    useExploreData();

  const [draftExploreState, setDraftExploreState] =
    useState<ProductAnalyticsConfig>(INITIAL_EXPLORE_STATE);

  const [submittedExploreState, setSubmittedExploreState] =
    useState<ProductAnalyticsConfig | null>(null);

  const hasPendingChanges = useMemo(
    () => !isEqual(draftExploreState, submittedExploreState),
    [draftExploreState, submittedExploreState],
  );

  const handleSubmit = useCallback(async () => {
    await fetchData(draftExploreState);
    console.log("fetched data", data);
    setSubmittedExploreState(draftExploreState);
  }, [draftExploreState]);

  const addValueToDataset = useCallback(
    (valueType: DatasetType) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== valueType) {
          return prev;
        }
        const value = createEmptyValue(valueType);

        // Generate unique name
        const existingNames = new Set(prev.dataset.values.map((v) => v.name));
        let i = 1;
        while (existingNames.has(`Series ${i}`)) {
          i++;
        }
        value.name = `Series ${i}`;

        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            values: assignSeriesColorsAndTags([...prev.dataset.values, value]),
          },
        } as ProductAnalyticsConfig;
      });
    },
    [],
  );

  const updateValueInDataset = useCallback((index: number, value: ProductAnalyticsValue) => {
    setDraftExploreState((prev) => {
      if (!prev.dataset || prev.dataset.type !== value.type) {
        return prev;
      }
      return {
        ...prev,
        dataset: {
          ...prev.dataset,
          values: [...prev.dataset.values.slice(0, index), value, ...prev.dataset.values.slice(index + 1)],
        },
      } as ProductAnalyticsConfig;
    });
  }, []);

  const deleteValueFromDataset = useCallback((index: number) => {
    setDraftExploreState((prev) => {
      if (!prev.dataset) {
        return prev;
      }
      const newValues = [...prev.dataset.values.slice(0, index), ...prev.dataset.values.slice(index + 1)];
      return {
        ...prev,
        dataset: { ...prev.dataset, values: assignSeriesColorsAndTags(newValues) },
      } as ProductAnalyticsConfig;
    });
  }, []);


  const changeDatasetType = useCallback((type: DatasetType) => {
    setDraftExploreState((prev) => {
      return {
        ...prev,
        dataset: createEmptyDataset(type),
      } as ProductAnalyticsConfig;
    });
  }, []);

  const clearDataset = useCallback(() => {
    setDraftExploreState((prev) => {
        return {
          ...prev,
          dataset: createEmptyDataset(prev.dataset.type),
        } as ProductAnalyticsConfig;
    });
  }, []);

  const value = useMemo<ExplorerContextValue>(
    () => ({
      draftExploreState,
      submittedExploreState,
      hasPendingChanges,
      exploreData: data,
      loading,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      clearDataset,
    }),
    [
      draftExploreState,
      submittedExploreState,
      hasPendingChanges,
      data,
      loading,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      clearDataset,
      hasPendingChanges,
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
