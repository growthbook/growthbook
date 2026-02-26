import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import { ColumnInterface } from "shared/types/fact-table";
import {
  ProductAnalyticsConfig,
  ProductAnalyticsValue,
  DatasetType,
} from "shared/src/validators/product-analytics";
import { ProductAnalyticsExploration } from "shared/validators";
import { DEFAULT_EXPLORE_STATE } from "shared/enterprise";
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
import { useExploreData, CacheOption } from "./useExploreData";
import { QueryInterface } from "shared/types/query";

type ExplorerCacheValue = {
  draftState: ProductAnalyticsConfig | null;
  submittedState: ProductAnalyticsConfig | null;
  exploration: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
  error: string | null;
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
  exploration: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
  loading: boolean;
  error: string | null;
  commonColumns: Pick<ColumnInterface, "column" | "name">[];
  isEmpty: boolean;
  isStale: boolean;
  needsUpdate: boolean;
  isSubmittable: boolean;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: (action: SetDraftStateAction) => void;
  handleSubmit: (options?: { force?: boolean }) => Promise<void>;
  addValueToDataset: (datasetType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  updateTimestampColumn: (column: string) => void;
  changeChartType: (chartType: ProductAnalyticsConfig["chartType"]) => void;
  clearAllDatasets: (newDatasourceId?: string) => void;
}
const ExplorerContext = createContext<ExplorerContextValue | null>(null);

interface ExplorerProviderProps {
  children: ReactNode;
  initialConfig: ProductAnalyticsConfig;
  onRunComplete?: (exploration: ProductAnalyticsExploration) => void;
}

export function ExplorerProvider({
  children,
  initialConfig,
  onRunComplete,
}: ExplorerProviderProps) {
  const { loading, fetchData } = useExploreData();

  const { getFactTableById, getFactMetricById, datasources } = useDefinitions();

  const activeExplorerType = initialConfig?.dataset.type || "metric";
  const [explorerCache, setExplorerCache] = useState<ExplorerCache>(() => {
    return {
      metric: null,
      fact_table: null,
      data_source: null,
      [activeExplorerType]: {
        draftState: null,
        submittedState: initialConfig,
        exploration: null,
        error: null,
        query: null,
      },
    };
  });
  const [isStale, setIsStale] = useState(false);
  const hasEverFetchedRef = useRef(false);

  const isEmpty = activeExplorerType === null;

  const INITIAL_EXPLORE_STATE = useMemo(
    () =>
      initialConfig || {
        ...DEFAULT_EXPLORE_STATE,
        datasource: datasources[0]?.id || "",
      },
    [initialConfig, datasources],
  );

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

  const isManagedWarehouse = useMemo(() => {
    if (!draftExploreState.datasource) return false;
    const datasource = datasources.find(
      (d) => d.id === draftExploreState.datasource,
    );
    return datasource?.type === "growthbook_clickhouse";
  }, [datasources, draftExploreState.datasource]);

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
    : (explorerCache[activeExplorerType]?.exploration ?? null);
  const error = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.error ?? null);
  const submittedExploreState = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.submittedState ?? null);
  const query = isEmpty
    ? null
    : (explorerCache[activeExplorerType]?.query ?? null);

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

  const baselineConfig = submittedExploreState ?? null;
  const { needsFetch, needsUpdate } = useMemo(() => {
    return compareConfig(baselineConfig, cleanedDraftExploreState);
  }, [baselineConfig, cleanedDraftExploreState]);

  const isSubmittable = useMemo(() => {
    return isSubmittableConfig(cleanedDraftExploreState);
  }, [cleanedDraftExploreState]);

  const doSubmit = useCallback(
    async (options?: { cache?: CacheOption }) => {
      if (isEmpty || !isSubmittable) return;

      let cache: CacheOption;
      if (options?.cache) {
        // explicitly set the cache option
        cache = options.cache;
      } else if (!hasEverFetchedRef.current || isManagedWarehouse) {
        // first load or managed warehouse: use preferred cache
        cache = "preferred";
      } else {
        // otherwise, use required cache
        cache = "required";
      }
      hasEverFetchedRef.current = true;

      // Do the fetch (we keep previous exploration/submitted state visible until result arrives)
      const { data: fetchResult, query, error: fetchError } = await fetchData(
        cleanedDraftExploreState,
        { cache },
      );

      // Cache miss when cache=required
      if (cache === "required" && fetchResult === null && !fetchError) {
        setIsStale(true);
        return;
      }

      // Clear staleness when there is an error
      if (fetchError) {
        setIsStale(false);
        setSubmittedExploreState(cleanedDraftExploreState);
      }

      // Set staleness to false and update submitted state when there is a result
      if (fetchResult) {
        setSubmittedExploreState(cleanedDraftExploreState);
        setIsStale(false);
      }

      setExplorerCache((prev) => ({
        ...prev,
        [activeExplorerType]: {
          ...prev[activeExplorerType],
          exploration: fetchResult,
          query,
          error: fetchError || fetchResult?.error || null,
        },
      }));
      if (fetchResult) onRunComplete?.(fetchResult);
    },
    [
      setSubmittedExploreState,
      fetchData,
      activeExplorerType,
      isEmpty,
      isSubmittable,
      cleanedDraftExploreState,
      onRunComplete,
      isManagedWarehouse,
    ],
  );

  const handleSubmit = useCallback(
    async (submitOptions?: { force?: boolean }) => {
      if (submitOptions?.force) {
        await doSubmit({ cache: "never" });
      } else {
        await doSubmit();
      }
    },
    [doSubmit],
  );

  /** Handle auto-submit based on needsFetch and needsUpdate */
  useEffect(() => {
    if (!isSubmittable) return;
    if (needsFetch) {
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
  ]);

  /** Clear staleness when draft matches submitted (known state) */
  useEffect(() => {
    if (isStale && !needsFetch && !needsUpdate) {
      setIsStale(false);
    }
  }, [isStale, needsFetch, needsUpdate]);

  const createDefaultValue = useCallback(
    (datasetType: DatasetType): ProductAnalyticsValue => {
      return createEmptyValue(datasetType);
    },
    [],
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
        let dataset = prev.dataset;

        // Big Number: normalize to single value and no dimensions so config matches what we display
        if (chartType === "bigNumber") {
          dimensions = [];
          const values = prev.dataset?.values ?? [];
          if (values.length > 1) {
            dataset = {
              ...prev.dataset,
              values: values.slice(0, 1),
            } as ProductAnalyticsConfig["dataset"];
          }
        } else {
          // Time-series charts (line, area) need date dimensions
          const isTimeSeriesChart =
            chartType === "line" ||
            chartType === "area" ||
            chartType === "timeseries-table";

          if (!isTimeSeriesChart) {
            dimensions = dimensions.filter((d) => d.dimensionType !== "date");
          } else if (!dimensions.some((d) => d.dimensionType === "date")) {
            dimensions = [
              {
                dimensionType: "date",
                column: "date",
                dateGranularity: "day",
              },
              ...dimensions,
            ];
          }
        }
        return { ...prev, chartType, dimensions, dataset };
      });
    },
    [setDraftExploreState],
  );

  const clearAllDatasets = useCallback(
    (newDatasourceId?: string) => {
      const datasourceId = newDatasourceId ?? datasources[0]?.id ?? "";
      setIsStale(false);
      const newExplorerCache: ExplorerCache = {
        metric: null,
        fact_table: null,
        data_source: null,
      };
      for (const type of Object.keys(explorerCache) as DatasetType[]) {
        const defaultDataset = createEmptyDataset(type);
        const defaultDraftState = {
          ...INITIAL_EXPLORE_STATE,
          datasource: datasourceId,
          dataset: { ...defaultDataset, values: [createDefaultValue(type)] },
        } as ProductAnalyticsConfig;
        newExplorerCache[type] = {
          draftState: defaultDraftState,
          submittedState: null,
          exploration: null,
          error: null,
          query: null,
        };
      }
      setExplorerCache(newExplorerCache);
    },
    [explorerCache, createDefaultValue, datasources, INITIAL_EXPLORE_STATE],
  );

  const value = useMemo<ExplorerContextValue>(
    () => ({
      draftExploreState,
      submittedExploreState,
      exploration: data,
      loading,
      error,
      commonColumns,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      isStale,
      needsUpdate,
      isSubmittable,
      clearAllDatasets,
      query,
    }),
    [
      draftExploreState,
      submittedExploreState,
      data,
      loading,
      error,
      commonColumns,
      setDraftExploreState,
      handleSubmit,
      addValueToDataset,
      updateValueInDataset,
      deleteValueFromDataset,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      isStale,
      needsUpdate,
      isSubmittable,
      clearAllDatasets,
      query,
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
