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
  ExplorationConfig,
  ProductAnalyticsValue,
  DatasetType,
  ProductAnalyticsExploration,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  cleanConfigForSubmission,
  clearInapplicableShowAs,
  compareConfig,
  createEmptyDataset,
  createEmptyValue,
  fillMissingUnits,
  generateUniqueValueName,
  getCommonColumns,
  isSubmittableConfig,
  validateDimensions,
} from "@/enterprise/components/ProductAnalytics/util";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import track from "@/services/track";
import { useExploreData, CacheOption } from "./useExploreData";

const MAX_TRACKED_ERROR_LENGTH = 500;

type SetDraftStateAction =
  | ExplorationConfig
  | ((prevState: ExplorationConfig) => ExplorationConfig);

export interface ExplorerContextValue {
  // ─── State ─────────────────────────────────────────────────────────────
  draftExploreState: ExplorationConfig;
  submittedExploreState: ExplorationConfig | null;
  exploration: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
  loading: boolean;
  error: string | null;
  commonColumns: Pick<ColumnInterface, "column" | "name">[];
  isStale: boolean;
  needsFetch: boolean;
  needsUpdate: boolean;
  isSubmittable: boolean;
  trackingSource: string | undefined;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: (action: SetDraftStateAction) => void;
  handleSubmit: (options?: {
    force?: boolean;
    config?: ExplorationConfig;
    setDraft?: boolean;
  }) => Promise<void>;
  addValueToDataset: (datasetType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  updateTimestampColumn: (column: string) => void;
  changeChartType: (chartType: ExplorationConfig["chartType"]) => void;
  clearAllDatasets: (newDatasourceId?: string) => void;
}
const ExplorerContext = createContext<ExplorerContextValue | null>(null);

export const LOCALSTORAGE_EXPLORER_DATASOURCE_KEY =
  "product-analytics:explorer:datasource" as const;

export function useDefaultDataSourceId(): string | undefined {
  const { datasources } = useDefinitions();

  const [defaultDataSourceId] = useLocalStorage<string | undefined>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    datasources[0]?.id ?? "",
  );

  return useMemo(() => {
    return datasources.some((d) => d.id === defaultDataSourceId)
      ? defaultDataSourceId
      : (datasources[0]?.id ?? "");
  }, [datasources, defaultDataSourceId]);
}

interface ExplorerProviderProps {
  children: ReactNode;
  initialConfig: ExplorationConfig;
  hasExistingResults?: boolean;
  onRunComplete?: (exploration: ProductAnalyticsExploration) => void;
  trackingSource?: string;
}

export function ExplorerProvider({
  children,
  initialConfig,
  hasExistingResults = false,
  onRunComplete,
  trackingSource,
}: ExplorerProviderProps) {
  const { loading, fetchData } = useExploreData();
  const {
    getFactTableById,
    getFactMetricById,
    datasources,
    getDatasourceById,
  } = useDefinitions();

  const [, setDefaultDataSourceId] = useLocalStorage<string>(
    LOCALSTORAGE_EXPLORER_DATASOURCE_KEY,
    datasources[0]?.id ?? "",
  );

  const [explorerState, setExplorerState] = useState<{
    draftState: ExplorationConfig;
    submittedState: ExplorationConfig | null;
    exploration: ProductAnalyticsExploration | null;
    error: string | null;
    query: QueryInterface | null;
  }>(() => {
    const withUnits = fillMissingUnits(
      initialConfig,
      getFactTableById,
      getFactMetricById,
    );
    const normalizedInitial = clearInapplicableShowAs(
      withUnits,
      getFactMetricById,
    );
    return {
      draftState: normalizedInitial,
      submittedState: hasExistingResults ? normalizedInitial : null,
      exploration: null,
      error: null,
      query: null,
    };
  });
  const [isStale, setIsStale] = useState(false);
  const hasEverFetchedRef = useRef(false);
  const skipNextAutoSubmitRef = useRef(false);
  const submitRequestIdRef = useRef(0);

  const draftExploreState: ExplorationConfig = explorerState.draftState;

  const setDraftExploreState = useCallback(
    (newStateOrUpdater: SetDraftStateAction) => {
      setExplorerState((prev) => {
        const currentDraft = prev.draftState;
        const newState =
          typeof newStateOrUpdater === "function"
            ? newStateOrUpdater(currentDraft)
            : newStateOrUpdater;

        // Backfill missing units from the fact table's primary userIdType
        // so configs loaded from URLs, saved explorations, or AI-generated
        // payloads always have a unit set when one is applicable.
        const unitFilledState = fillMissingUnits(
          newState,
          getFactTableById,
          getFactMetricById,
        );
        // Strip `showAs` when the current dataset doesn't support it, so the
        // stored value never disagrees with what the chart actually renders.
        const showAsNormalized = clearInapplicableShowAs(
          unitFilledState,
          getFactMetricById,
        );
        const validatedState = validateDimensions(
          showAsNormalized,
          getFactTableById,
          getFactMetricById,
        );

        return {
          ...prev,
          draftState: validatedState,
        };
      });
    },
    [getFactTableById, getFactMetricById],
  );

  // Re-normalize the draft state whenever the definitions resolver functions
  // change identity — this handles the case where an initialConfig loaded from
  // a URL or saved exploration needed metric/fact-table lookups that weren't
  // resolved yet at first render. Both fillMissingUnits and
  // clearInapplicableShowAs return the same reference when nothing changes,
  // so the setExplorerState is a no-op in the steady state.
  useEffect(() => {
    setExplorerState((prev) => {
      const filled = fillMissingUnits(
        prev.draftState,
        getFactTableById,
        getFactMetricById,
      );
      const normalized = clearInapplicableShowAs(filled, getFactMetricById);
      if (normalized === prev.draftState) return prev;
      return { ...prev, draftState: normalized };
    });
  }, [getFactTableById, getFactMetricById]);

  const isManagedWarehouse = useMemo(() => {
    if (!draftExploreState.datasource) return false;
    const datasource = getDatasourceById(draftExploreState.datasource);
    return datasource?.type === "growthbook_clickhouse";
  }, [getDatasourceById, draftExploreState.datasource]);

  const setSubmittedExploreState = useCallback((state: ExplorationConfig) => {
    setExplorerState((prev) => ({
      ...prev,
      submittedState: state,
    }));
  }, []);

  const data = explorerState.exploration;
  const error = explorerState.error;
  const submittedExploreState = explorerState.submittedState;
  const query = explorerState.query;

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
    async (options?: { cache?: CacheOption; config?: ExplorationConfig }) => {
      const configToSubmit = cleanConfigForSubmission(
        options?.config ?? draftExploreState,
      );
      if (!isSubmittableConfig(configToSubmit)) return;

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
      const requestId = ++submitRequestIdRef.current;

      const startTime = Date.now();
      // Do the fetch (we keep previous exploration/submitted state visible until result arrives)
      const {
        data: fetchResult,
        query,
        error: fetchError,
      } = await fetchData(configToSubmit, { cache });
      const durationMs = Date.now() - startTime;

      // Ignore out-of-order responses from older in-flight requests.
      if (requestId !== submitRequestIdRef.current) return;

      // Cache miss when cache=required
      if (cache === "required" && fetchResult === null && !fetchError) {
        setIsStale(true);
        return;
      }

      // Clear staleness when there is an error
      if (fetchError) {
        setIsStale(false);
        setSubmittedExploreState(configToSubmit);
      }

      // Set staleness to false and update submitted state when there is a result
      if (fetchResult) {
        setSubmittedExploreState(configToSubmit);
        setIsStale(false);
      }

      setExplorerState((prev) => ({
        ...prev,
        exploration: fetchResult,
        query,
        error: fetchError || fetchResult?.error || null,
      }));
      if (fetchResult) onRunComplete?.(fetchResult);

      if (trackingSource) {
        const datasourceType =
          getDatasourceById(configToSubmit.datasource)?.type ?? null;
        const errorMessage = fetchError || fetchResult?.error || null;
        const baseProps = {
          source: trackingSource,
          type: configToSubmit.type,
          chart_type: configToSubmit.chartType,
          datasource_type: datasourceType,
          duration_ms: durationMs,
          cache,
          num_values: configToSubmit.dataset?.values?.length ?? 0,
          num_dimensions: configToSubmit.dimensions?.length ?? 0,
        };
        if (errorMessage) {
          track("Product Analytics Explorer: Refresh Failure", {
            ...baseProps,
            error_message: errorMessage.slice(0, MAX_TRACKED_ERROR_LENGTH),
          });
        } else if (fetchResult) {
          track("Product Analytics Explorer: Refresh Success", {
            ...baseProps,
            row_count: fetchResult.result?.rows?.length ?? 0,
          });
        }
      }
    },
    [
      draftExploreState,
      setSubmittedExploreState,
      fetchData,
      onRunComplete,
      isManagedWarehouse,
      trackingSource,
      getDatasourceById,
    ],
  );

  const handleSubmit = useCallback(
    async (submitOptions?: {
      force?: boolean;
      config?: ExplorationConfig;
      setDraft?: boolean;
    }) => {
      if (submitOptions?.setDraft && submitOptions.config) {
        skipNextAutoSubmitRef.current = true;
        setDraftExploreState(submitOptions.config);
      }

      if (submitOptions?.force) {
        await doSubmit({ cache: "never", config: submitOptions?.config });
      } else {
        await doSubmit({ config: submitOptions?.config });
      }
    },
    [doSubmit, setDraftExploreState],
  );

  /** Handle auto-submit based on needsFetch and needsUpdate */
  useEffect(() => {
    if (!isSubmittable) return;
    if (skipNextAutoSubmitRef.current) {
      skipNextAutoSubmitRef.current = false;
      return;
    }
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
        } as ExplorationConfig;
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
        } as ExplorationConfig;
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
        } as ExplorationConfig;
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
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  const changeChartType = useCallback(
    (chartType: ExplorationConfig["chartType"]) => {
      if (trackingSource && draftExploreState.chartType !== chartType) {
        track("Product Analytics Explorer: Chart Type Changed", {
          source: trackingSource,
          type: draftExploreState.type,
          from_chart_type: draftExploreState.chartType,
          to_chart_type: chartType,
        });
      }
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
            } as ExplorationConfig["dataset"];
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
        return { ...prev, chartType, dimensions, dataset } as ExplorationConfig;
      });
    },
    [
      setDraftExploreState,
      trackingSource,
      draftExploreState.chartType,
      draftExploreState.type,
    ],
  );

  const clearAllDatasets = useCallback(
    (newDatasourceId?: string) => {
      const datasourceId: string = newDatasourceId ?? datasources[0]?.id ?? "";
      setIsStale(false);
      if (datasourceId) {
        setDefaultDataSourceId(datasourceId);
      }

      if (
        trackingSource &&
        newDatasourceId &&
        newDatasourceId !== draftExploreState.datasource
      ) {
        const fromDs = getDatasourceById(draftExploreState.datasource);
        const toDs = getDatasourceById(newDatasourceId);
        track("Product Analytics Explorer: Datasource Changed", {
          source: trackingSource,
          type: draftExploreState.type,
          from_datasource_type: fromDs?.type ?? null,
          to_datasource_type: toDs?.type ?? null,
        });
      }

      setExplorerState((prev) => {
        const type = prev.draftState.dataset.type;
        return {
          draftState: {
            ...initialConfig,
            datasource: datasourceId,
            dataset: {
              ...createEmptyDataset(type),
              values: [createDefaultValue(type)],
            },
          } as ExplorationConfig,
          submittedState: null,
          exploration: null,
          error: null,
          query: null,
        };
      });
    },
    [
      createDefaultValue,
      datasources,
      getDatasourceById,
      initialConfig,
      setDefaultDataSourceId,
      trackingSource,
      draftExploreState.datasource,
      draftExploreState.type,
    ],
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
      isStale,
      needsFetch,
      needsUpdate,
      isSubmittable,
      clearAllDatasets,
      query,
      trackingSource,
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
      isStale,
      needsFetch,
      needsUpdate,
      isSubmittable,
      clearAllDatasets,
      query,
      trackingSource,
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
