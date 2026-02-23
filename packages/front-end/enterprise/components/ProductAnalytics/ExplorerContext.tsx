import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  ReactNode,
  useEffect,
} from "react";
import { ColumnInterface } from "shared/types/fact-table";
import {
  ProductAnalyticsConfig,
  ProductAnalyticsResult,
  ProductAnalyticsValue,
  DatasetType,
} from "shared/src/validators/product-analytics";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  cleanConfigForSubmission,
  compareConfig,
  createEmptyDataset,
  createEmptyValue,
  generateUniqueValueName,
  getCommonColumns,
  isSubmittableConfig,
  validateDimensions,
} from "@/enterprise/components/ProductAnalytics/util";
import { useExploreData } from "./useExploreData";


type ExplorerCacheValue = {
  draftState: ProductAnalyticsConfig | null;
  submittedState: ProductAnalyticsConfig | null;
  exploreData: ProductAnalyticsResult | null;
  exploreError: Error | null;
  lastRefreshedAt: Date | null;
};

type ExplorerCache = {
  [key in DatasetType]: ExplorerCacheValue | null;
};

type SetDraftStateAction =
  | ProductAnalyticsConfig
  | ((prevState: ProductAnalyticsConfig) => ProductAnalyticsConfig);

export interface ExplorerContextValue {
  // ─── State ─────────────────────────────────────────────────────────────
  draftExploreState: ProductAnalyticsConfig;
  submittedExploreState: ProductAnalyticsConfig | null;
  exploreData: ProductAnalyticsResult | null;
  exploreError: string | null;
  loading: boolean;
  lastRefreshedAt: Date | null;
  commonColumns: Pick<ColumnInterface, "column" | "name">[];
  isEmpty: boolean;
  autoSubmitEnabled: boolean;
  setAutoSubmitEnabled: (enabled: boolean) => void;
  isStale: boolean;
  isSubmittable: boolean;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: (action: SetDraftStateAction) => void;
  handleSubmit: () => Promise<void>;
  addValueToDataset: (datasetType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  changeDatasetType: (type: DatasetType) => void;
  updateTimestampColumn: (column: string) => void;
  changeChartType: (chartType: ProductAnalyticsConfig["chartType"]) => void;
}

const DEFAULT_EXPLORE_STATE: ProductAnalyticsConfig = {
  dataset: {
    type: "metric", // default to metric
    values: [],
  },
  dimensions: [
    {
      dimensionType: "date",
      column: "date",
      dateGranularity: "auto",
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
  lastRefreshedAt: null,
};
const ExplorerContext = createContext<ExplorerContextValue | null>(null);
const DEFAULT_AUTO_SUBMIT = true;

interface ExplorerProviderProps {
  children: ReactNode;
  initialConfig?: ProductAnalyticsConfig;
}

export function ExplorerProvider({
  children,
  initialConfig,
}: ExplorerProviderProps) {
  const { loading, fetchData } = useExploreData();

  const {
    getFactTableById,
    getFactMetricById,
    factMetrics,
    factTables,
    datasources,
  } = useDefinitions();

  const [activeExplorerType, setActiveExplorerType] =
    useState<DatasetType | null>(initialConfig?.dataset.type || null);
  const [explorerCache, setExplorerCache] = useState<ExplorerCache>({
    metric: null,
    fact_table: null,
    data_source: null,
  });
  const [autoSubmitEnabled, setAutoSubmitEnabled] =
    useState(DEFAULT_AUTO_SUBMIT);

  const isEmpty = activeExplorerType === null;

  const INITIAL_EXPLORE_STATE = initialConfig || DEFAULT_EXPLORE_STATE;

  const draftExploreState: ProductAnalyticsConfig = isEmpty
    ? INITIAL_EXPLORE_STATE
    : (explorerCache[activeExplorerType]?.draftState ?? INITIAL_EXPLORE_STATE);

  const setDraftExploreState = useCallback(
    (newStateOrUpdater: SetDraftStateAction) => {
      if (isEmpty) return;

      setExplorerCache((prev) => {
        const currentDraft =
          prev[activeExplorerType]?.draftState ?? INITIAL_EXPLORE_STATE;
        const newState =
          typeof newStateOrUpdater === "function"
            ? newStateOrUpdater(currentDraft)
            : newStateOrUpdater;

        // Validate dimensions against commonColumns
        const validatedState = validateDimensions(
          newState,
          getFactTableById,
          getFactMetricById,
        );

        return {
          ...prev,
          [activeExplorerType]: {
            ...prev[activeExplorerType],
            draftState: validatedState,
          },
        };
      });
    },
    [
      activeExplorerType,
      getFactTableById,
      getFactMetricById,
      isEmpty,
      INITIAL_EXPLORE_STATE,
    ],
  );

  const setSubmittedExploreState = useCallback(
    (state: ProductAnalyticsConfig) => {
      if (isEmpty) return;
      setExplorerCache((prev) => ({
        ...prev,
        [activeExplorerType]: {
          ...prev[activeExplorerType],
          submittedState: state,
        },
      }));
    },
    [activeExplorerType, isEmpty],
  );

  const data = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.exploreData ?? null);
  const error = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.exploreError ?? null);
  const lastRefreshedAt = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.lastRefreshedAt ?? null);
  const submittedExploreState = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.submittedState ?? null);

  const commonColumns = useMemo(() => {
    return getCommonColumns(
      draftExploreState.dataset,
      getFactTableById,
      getFactMetricById,
    );
  }, [draftExploreState.dataset, getFactTableById, getFactMetricById]);

  const cleanedDraftExploreState = useMemo(() => {
    return cleanConfigForSubmission(draftExploreState);
  }, [draftExploreState]);

  const { needsFetch, needsUpdate } = useMemo(() => {
    return compareConfig(
      submittedExploreState ?? null,
      cleanedDraftExploreState,
    );
  }, [submittedExploreState, cleanedDraftExploreState]);

  const isStale = needsUpdate && needsFetch && !autoSubmitEnabled;

  const isSubmittable = useMemo(() => {
    return isSubmittableConfig(cleanedDraftExploreState);
  }, [cleanedDraftExploreState]);

  const doSubmit = useCallback(async () => {
    if (isEmpty || !isSubmittable) return;
    setSubmittedExploreState(cleanedDraftExploreState);
    const { data, error } = await fetchData(cleanedDraftExploreState);
    setExplorerCache((prev) => ({
      ...prev,
      [activeExplorerType]: {
        ...prev[activeExplorerType],
        exploreData: data,
        exploreError: error,
        lastRefreshedAt: new Date(),
      },
    }));
  }, [
    setSubmittedExploreState,
    fetchData,
    activeExplorerType,
    isEmpty,
    isSubmittable,
    cleanedDraftExploreState,
  ]);

  const handleSubmit = useCallback(async () => {
    await doSubmit();
  }, [doSubmit]);

  useEffect(() => {
    if (!isSubmittable) return;
    if (needsFetch && autoSubmitEnabled) {
      doSubmit();
    } else if (needsUpdate && !needsFetch) {
      setSubmittedExploreState(cleanedDraftExploreState);
    }
  }, [
    needsFetch,
    needsUpdate,
    doSubmit,
    cleanedDraftExploreState,
    setSubmittedExploreState,
    isSubmittable,
    autoSubmitEnabled,
  ]);

  const createDefaultValue = useCallback(
    (datasetType: DatasetType): ProductAnalyticsValue => {
      const factMetric = datasetType === "metric" ? factMetrics[0] : null;
      const factTable =
        datasetType === "metric" && factMetric?.numerator.factTableId
          ? getFactTableById(factMetric.numerator.factTableId)
          : factTables[0];
      return createEmptyValue(datasetType, factTable);
    },
    [factMetrics, factTables, getFactTableById],
  );

  const addValueToDataset = useCallback(
    (datasetType: DatasetType) => {
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
    },
    [createDefaultValue, setDraftExploreState],
  );

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
    [setDraftExploreState],
  );

  const deleteValueFromDataset = useCallback(
    (index: number) => {
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
    },
    [setDraftExploreState],
  );

  const updateTimestampColumn = useCallback(
    (column: string) => {
      setDraftExploreState((prev) => {
        if (!prev.dataset) {
          return prev;
        }
        return {
          ...prev,
          dataset: { ...prev.dataset, timestampColumn: column },
        } as ProductAnalyticsConfig;
      });
    },
    [setDraftExploreState],
  );

  const changeChartType = useCallback(
    (chartType: ProductAnalyticsConfig["chartType"]) => {
      setDraftExploreState((prev) => {
        let dimensions = prev.dimensions;
        // Time-series charts (line, area) need date dimensions
        const isTimeSeriesChart =
          chartType === "line" ||
          chartType === "area" ||
          chartType === "timeseries-table";

        if (!isTimeSeriesChart) {
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
    [setDraftExploreState],
  );

  const changeDatasetType = useCallback(
    (type: DatasetType) => {
      setActiveExplorerType(type);

      // if explorer cache is null for this type, we should create a default draft state
      if (!explorerCache[type]) {
        const defaultDataset = createEmptyDataset(type, datasources[0]?.id);
        const defaultDraftState = {
          ...INITIAL_EXPLORE_STATE,
          dataset: { ...defaultDataset, values: [createDefaultValue(type)] },
        } as ProductAnalyticsConfig;
        setExplorerCache((prev) => ({
          ...prev,
          [type]: {
            ...prev[type],
            draftState: defaultDraftState,
          },
        }));
        return defaultDraftState;
      }
    },
    [explorerCache, createDefaultValue, datasources, INITIAL_EXPLORE_STATE],
  );

  const value = useMemo<ExplorerContextValue>(
    () => ({
      draftExploreState,
      submittedExploreState,
      exploreData: data,
      exploreError: error?.message || null,
      loading,
      lastRefreshedAt,
      commonColumns,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      autoSubmitEnabled,
      setAutoSubmitEnabled,
      isStale,
      isSubmittable,
    }),
    [
      draftExploreState,
      submittedExploreState,
      data,
      loading,
      error,
      lastRefreshedAt,
      commonColumns,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      changeDatasetType,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      autoSubmitEnabled,
      setAutoSubmitEnabled,
      isStale,
      isSubmittable,
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
