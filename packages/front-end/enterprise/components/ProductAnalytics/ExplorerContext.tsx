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
import {
  createEmptyValue,
  createEmptyDataset,
  getCommonColumns,
  generateUniqueValueName,
  removeIncompleteValues,
  getMaxDimensions,
} from "./util";
import { useExploreData } from "./useExploreData";
import {
  DatasetType,
  ProductAnalyticsConfig,
  ProductAnalyticsResult,
  ProductAnalyticsValue,
} from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { ColumnInterface } from "shared/types/fact-table";

// Helper function for timestamp detection for sql exploration
function autoDetectTimestamp(
  columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  >,
): string | null {
  //MKTODO: This is a simple version to get us started. Need to improve.
  // First, try to find a column with "timestamp" in the name
  let timestampColumn = Object.keys(columnTypes).find((key) =>
    key.toLowerCase().includes("timestamp"),
  );

  // If not found, look for other common date column names
  if (!timestampColumn) {
    timestampColumn = Object.keys(columnTypes).find((key) => {
      const lowerKey = key.toLowerCase();
      return (
        lowerKey.includes("date") ||
        lowerKey.includes("time") ||
        lowerKey === "created_at" ||
        lowerKey === "updated_at"
      );
    });
  }

  // If still not found, just pick the first date-type column
  if (!timestampColumn) {
    timestampColumn = Object.keys(columnTypes).find(
      (key) => columnTypes[key] === "date",
    );
  }

  return timestampColumn || null;
}

const INITIAL_EXPLORE_STATE: ProductAnalyticsConfig = {
  dataset: {
    type: "metric", // default to metric
    values: [],
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
  exploreError: string | null;
  loading: boolean;
  commonColumns: Pick<ColumnInterface, "column" | "name">[];

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: React.Dispatch<
    React.SetStateAction<ProductAnalyticsConfig>
  >;
  handleSubmit: () => Promise<void>;
  addValueToDataset: (datasetType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  changeDatasetType: (type: DatasetType) => void;
  updateSqlDataset: (
    sql: string,
    columnTypes: Record<
      string,
      "string" | "number" | "date" | "boolean" | "other"
    >,
  ) => void;
  updateTimestampColumn: (column: string) => void;
  changeChartType: (chartType: ProductAnalyticsConfig["chartType"]) => void;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

interface ExplorerProviderProps {
  children: ReactNode;
}

export function ExplorerProvider({ children }: ExplorerProviderProps) {
  const { data, loading, fetchData, error } = useExploreData();

  const { getFactTableById, getFactMetricById, factMetrics, factTables } = useDefinitions();

  const [draftExploreState, setDraftExploreState] =
    useState<ProductAnalyticsConfig>(INITIAL_EXPLORE_STATE);

  const [submittedExploreState, setSubmittedExploreState] =
    useState<ProductAnalyticsConfig | null>(null);

  const hasPendingChanges = useMemo(
    () => !isEqual(draftExploreState, submittedExploreState),
    [draftExploreState, submittedExploreState],
  );

  const commonColumns = useMemo(() => {
    return getCommonColumns(
      draftExploreState.dataset,
      getFactTableById,
      getFactMetricById,
    );
  }, [draftExploreState.dataset, getFactTableById, getFactMetricById]);

  useEffect(() => {
    // 1. Validate dimensions against commonColumns
    let validDimensions = draftExploreState.dimensions.filter((d) => {
      if (d.dimensionType !== "dynamic") return true;
      return commonColumns.some((c) => c.column === d.column);
    });

  // 1a. Truncate dimensions if they exceed the max number of dimensions
    const maxDimensions = getMaxDimensions(draftExploreState.dataset);
    if (validDimensions.length > maxDimensions) {
      validDimensions = validDimensions.slice(0, maxDimensions);
    } 

    if (validDimensions.length !== draftExploreState.dimensions.length) {
      setDraftExploreState((prev) => ({
        ...prev,
        dimensions: validDimensions,
      }));
      return; // Re-render with valid dimensions before submitting
    }

    // 2. Auto-submit if there are pending changes
    if (hasPendingChanges && draftExploreState.dataset.values.length > 0) {
      const cleanedDataset = removeIncompleteValues(draftExploreState.dataset);
      if (cleanedDataset.values.length === 0) return;
      fetchData({ ...draftExploreState, dataset: cleanedDataset });
      setSubmittedExploreState(draftExploreState);
    }
  }, [commonColumns, hasPendingChanges, draftExploreState]);


  const handleSubmit = useCallback(async () => {
    await fetchData(draftExploreState);
    setSubmittedExploreState(draftExploreState);
  }, [draftExploreState]);

  const createDefaultValue = useCallback((datasetType: DatasetType): ProductAnalyticsValue => {
    const factMetric = datasetType === "metric" ? factMetrics[0] : null;
    const factTable = datasetType === "metric" && factMetric?.numerator.factTableId ? getFactTableById(factMetric.numerator.factTableId) : factTables[0];
    return createEmptyValue(datasetType, factTable, factMetric);
  }, [factMetrics, factTables, getFactTableById]);

  const addValueToDataset = useCallback((datasetType: DatasetType) => {
    setDraftExploreState((prev) => {
      if (!prev.dataset || prev.dataset.type !== datasetType) {
        return prev;
      }
      const value = createDefaultValue(datasetType);

      // Generate unique name
      if (value.name) {
        value.name = generateUniqueValueName(value.name, prev.dataset.values);
      }

      return {
        ...prev,
        dataset: {
          ...prev.dataset,
          values: [...prev.dataset.values, value],
        },
      } as ProductAnalyticsConfig;
    });
  }, []);

  const updateValueInDataset = useCallback(
    (index: number, value: ProductAnalyticsValue) => {
      setDraftExploreState((prev) => {
        if (!prev.dataset || prev.dataset.type !== value.type) {
          return prev;
        }
        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            values: [
              ...prev.dataset.values.slice(0, index),
              value,
              ...prev.dataset.values.slice(index + 1),
            ],
          },
        } as ProductAnalyticsConfig;
      });
    },
    [],
  );

  const deleteValueFromDataset = useCallback((index: number) => {
    setDraftExploreState((prev) => {
      if (!prev.dataset) {
        return prev;
      }
      const newValues = [
        ...prev.dataset.values.slice(0, index),
        ...prev.dataset.values.slice(index + 1),
      ];
      return {
        ...prev,
        dataset: { ...prev.dataset, values: newValues },
      } as ProductAnalyticsConfig;
    });
  }, []);

  const updateSqlDataset = useCallback(
    (
      sql: string,
      columnTypes: Record<
        string,
        "string" | "number" | "date" | "boolean" | "other"
      >,
    ) => {
      setDraftExploreState((prev) => {
        if (!prev.dataset) {
          return prev;
        }

        // Auto-detect timestamp column from the new columnTypes
        const detectedTimestamp = autoDetectTimestamp(columnTypes);
        const currentTimestamp =
          prev.dataset.type === "sql" ? prev.dataset.timestampColumn : "";

        // Use detected timestamp if we don't have one, or if the current one is not in the new columns
        let timestampColumn = currentTimestamp;
        if (
          !currentTimestamp ||
          !Object.keys(columnTypes).includes(currentTimestamp)
        ) {
          timestampColumn = detectedTimestamp || "";
        }

        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            type: "sql",
            sql,
            columnTypes,
            timestampColumn,
          },
        } as ProductAnalyticsConfig;
      });
    },
    [],
  );

  const updateTimestampColumn = useCallback((column: string) => {
    setDraftExploreState((prev) => {
      if (!prev.dataset) {
        return prev;
      }
      return {
        ...prev,
        dataset: { ...prev.dataset, timestampColumn: column },
      } as ProductAnalyticsConfig;
    });
  }, []);

  // changes chart type and updates dimensions
  const changeChartType = useCallback(
    (chartType: ProductAnalyticsConfig["chartType"]) => {
      setDraftExploreState((prev) => {
        let dimensions = prev.dimensions;
        if (chartType !== "line") {
          dimensions = dimensions.filter((d) => d.dimensionType !== "date");
        } else if (!dimensions.some((d) => d.dimensionType === "date")) {
          dimensions = [
            { dimensionType: "date", column: "date", dateGranularity: "day" },
            ...dimensions,
          ];
        }
        return { ...prev, chartType, dimensions };
      });
    },
    [],
  );

  const changeDatasetType = useCallback((type: DatasetType) => {
    const defaultDataset = createEmptyDataset(type, factTables[0]);
    setDraftExploreState((prev) => {
      return {
        ...prev,
        dataset: { ...defaultDataset, values: [createDefaultValue(type)] },
      } as ProductAnalyticsConfig;
    });
  }, []);

  const value = useMemo<ExplorerContextValue>(
    () => ({
      draftExploreState,
      submittedExploreState,
      hasPendingChanges,
      exploreData: data,
      exploreError: error?.message || null,
      loading,
      commonColumns,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      updateSqlDataset,
      updateTimestampColumn,
      changeChartType,
    }),
    [
      draftExploreState,
      submittedExploreState,
      hasPendingChanges,
      data,
      loading,
      error,
      commonColumns,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      updateSqlDataset,
      updateTimestampColumn,
      changeChartType,
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
