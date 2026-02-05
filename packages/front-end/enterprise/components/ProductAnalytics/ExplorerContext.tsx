import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import isEqual from "lodash/isEqual";
import { createEmptyValue, createEmptyDataset, getCommonColumns } from "./util";
import { useExploreData } from "./useExploreData";
import { DatasetType, ProductAnalyticsConfig, ProductAnalyticsDataset, ProductAnalyticsResult, ProductAnalyticsValue, SqlValue } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ColumnInterface } from "shared/types/fact-table";

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
  commonColumns: ColumnInterface[];

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

  const { getFactTableById, getFactMetricById } = useDefinitions();

  const [draftExploreState, setDraftExploreState] =
    useState<ProductAnalyticsConfig>(INITIAL_EXPLORE_STATE);

  const [submittedExploreState, setSubmittedExploreState] =
    useState<ProductAnalyticsConfig | null>(null);

  const hasPendingChanges = useMemo(
    () => !isEqual(draftExploreState, submittedExploreState),
    [draftExploreState, submittedExploreState],
  );

  const commonColumns = useMemo(() => {
    return getCommonColumns(draftExploreState.dataset, getFactTableById, getFactMetricById);
  }, [draftExploreState.dataset, getFactTableById, getFactMetricById]);

  // Validate dimensions against commonColumns
  useEffect(() => {
    const newDimensions = draftExploreState.dimensions.filter(d => {
      if (d.dimensionType !== 'dynamic') return true;
      if (commonColumns.some(c => c.column === d.column)) return true;
      return false;
    });

    if (newDimensions != draftExploreState.dimensions) {
      setDraftExploreState(prev => ({
        ...prev,
        dimensions: newDimensions
      }));
    }
  }, [commonColumns]);

  useEffect(() => {
    // clear date dimension if chart type is not line
    if (draftExploreState.chartType !== 'line') {
      console.log("clearing date dimension");
      setDraftExploreState(prev => ({
        ...prev,
        dimensions: prev.dimensions.filter(d => d.dimensionType !== 'date')
      }));
    }
  }, [draftExploreState.chartType])

  const handleSubmit = useCallback(async () => {
    await fetchData(draftExploreState);
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
            values: [...prev.dataset.values, value],
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
        dataset: { ...prev.dataset, values: newValues },
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
      commonColumns,
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
      commonColumns,
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
