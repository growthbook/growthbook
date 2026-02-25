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
import { useExploreData } from "./useExploreData";

type ExplorerCacheValue = {
  draftState: ProductAnalyticsConfig | null;
  submittedState: ProductAnalyticsConfig | null;
  exploration: ProductAnalyticsExploration | null;
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
  loading: boolean;
  error: string | null;
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
  clearAllDatasets: (newDatasourceId?: string) => void;
}
const ExplorerContext = createContext<ExplorerContextValue | null>(null);
const DEFAULT_AUTO_SUBMIT = true;
interface ExplorerProviderProps {
  children: ReactNode;
  initialConfig?: ProductAnalyticsConfig;
  /** Called when a run completes with the new exploration. Used by dashboard block editor to sync block. */
  onRunComplete?: (exploration: ProductAnalyticsExploration) => void;
  /** Called when draft has diverged from last run (needs fetch). Used by dashboard block editor to clear id. */
  onDraftDiverged?: (draftConfig: ProductAnalyticsConfig) => void;
}

export function ExplorerProvider({
  children,
  initialConfig,
  onRunComplete,
  onDraftDiverged,
}: ExplorerProviderProps) {
  const onDraftDivergedRef = useRef(onDraftDiverged);
  onDraftDivergedRef.current = onDraftDiverged;

  const { loading, fetchData } = useExploreData();

  const { getFactTableById, getFactMetricById, datasources } = useDefinitions();

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
        exploration: data,
        error: error || data?.error || null,
      },
    }));
    if (data) onRunComplete?.(data);
  }, [
    setSubmittedExploreState,
    fetchData,
    activeExplorerType,
    isEmpty,
    isSubmittable,
    cleanedDraftExploreState,
    onRunComplete,
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

  // When draft has diverged from baseline (initial or last run), notify so block editor can clear exploration id.
  // Use ref for callback to avoid infinite loop when parent re-creates it after setBlock.
  // Use baseline = submitted ?? initial so opening existing block and editing triggers onDraftDiverged.
  const baselineConfig = submittedExploreState ?? initialConfig ?? null;
  const { needsFetch: draftDiverged } = useMemo(
    () =>
      baselineConfig != null
        ? compareConfig(baselineConfig, cleanedDraftExploreState)
        : { needsFetch: false, needsUpdate: false },
    [baselineConfig, cleanedDraftExploreState],
  );
  useEffect(() => {
    if (draftDiverged && baselineConfig != null) {
      onDraftDivergedRef.current?.(cleanedDraftExploreState);
    }
  }, [draftDiverged, baselineConfig, cleanedDraftExploreState]);

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
        const defaultDataset = createEmptyDataset(type);
        const defaultDraftState = {
          ...INITIAL_EXPLORE_STATE,
          datasource: datasources[0]?.id || "",
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

  const clearAllDatasets = useCallback(
    (newDatasourceId?: string) => {
      const datasourceId = newDatasourceId ?? datasources[0]?.id ?? "";
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
      changeDatasetType,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      autoSubmitEnabled,
      setAutoSubmitEnabled,
      isStale,
      isSubmittable,
      clearAllDatasets,
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
      changeDatasetType,
      updateTimestampColumn,
      changeChartType,
      isEmpty,
      autoSubmitEnabled,
      setAutoSubmitEnabled,
      isStale,
      isSubmittable,
      clearAllDatasets,
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
