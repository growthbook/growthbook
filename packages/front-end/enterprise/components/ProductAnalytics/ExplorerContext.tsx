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
  ExplorationDateRange,
  type ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import {
  buildComparisonDateRange,
  buildContiguousPreviousCustomDateRange,
  computeExplorationComparisonPayload,
} from "shared/enterprise";
import { isEqual } from "lodash";
import { isManagedWarehouseUnavailable } from "shared/util";
import {
  cleanConfigForSubmission,
  clearInapplicableShowAs,
  compareConfig,
  explorationPollDelayMs,
  createEmptyDataset,
  createEmptyValue,
  ExplorerDraftConfig,
  fillMissingUnits,
  generateUniqueValueName,
  getCommonColumns,
  getInitialInlineFilters,
  hasUnsatisfiedInlineFilters,
  isSubmittableConfig,
  stripExplorerDraftFields,
  toFetchKey,
  validateDimensions,
} from "@/enterprise/components/ProductAnalytics/util";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { SqlEditorProvider } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import { useExploreData, CacheOption } from "./useExploreData";

const MAX_TRACKED_ERROR_LENGTH = 500;

function customPrimaryBoundsKey(
  dateRange: ExplorationConfig["dateRange"],
): string | null {
  if (
    dateRange.predefined !== "customDateRange" ||
    !dateRange.startDate ||
    !dateRange.endDate
  ) {
    return null;
  }
  return `${dateRange.startDate}|${dateRange.endDate}`;
}

type SetDraftStateAction =
  | ExplorerDraftConfig
  | ((prevState: ExplorerDraftConfig) => ExplorerDraftConfig);

export interface ExplorerContextValue {
  // ─── State ─────────────────────────────────────────────────────────────
  draftExploreState: ExplorerDraftConfig;
  submittedExploreState: ExplorerDraftConfig | null;
  exploration: ProductAnalyticsExploration | null;
  query: QueryInterface | null;
  loading: boolean;
  error: string | null;
  commonColumns: Pick<ColumnInterface, "column" | "name">[];
  isStale: boolean;
  needsFetch: boolean;
  needsUpdate: boolean;
  isSubmittable: boolean;
  managedWarehouseUnavailable: boolean;
  trackingSource: string | undefined;

  compareEnabled: boolean;
  submittedPreviousTimeFrame: ExplorationDateRange | null;
  comparisonExploration: ProductAnalyticsExploration | null;
  comparisonQuery: QueryInterface | null;
  comparisonComputed: Pick<
    ProductAnalyticsRunComparisonPayload,
    "bigNumberTrends" | "tableTrendsByRow" | "previousPeriod"
  > | null;
  setCompareEnabled: (value: boolean) => void;

  // ─── Modifiers ─────────────────────────────────────────────────────────
  setDraftExploreState: (action: SetDraftStateAction) => void;
  handleSubmit: (options?: {
    force?: boolean;
    config?: ExplorerDraftConfig;
    setDraft?: boolean;
  }) => Promise<void>;
  addValueToDataset: (datasetType: DatasetType) => void;
  updateValueInDataset: (index: number, value: ProductAnalyticsValue) => void;
  deleteValueFromDataset: (index: number) => void;
  updateTimestampColumn: (column: string) => void;
  changeChartType: (chartType: ExplorationConfig["chartType"]) => void;
  clearAllDatasets: (newDatasourceId?: string) => void;
  /** Funnel sidebar registers a handler; main empty-state CTA invokes before analyze. */
  registerFunnelAnalyzeCollapseHandler: (fn: (() => void) | null) => void;
  collapseFunnelStepsForAnalyze: () => void;
}
const ExplorerContext = createContext<ExplorerContextValue | null>(null);

const LOCALSTORAGE_EXPLORER_DATASOURCE_KEY =
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
  initialConfig: ExplorerDraftConfig;
  initialSubmittedConfig?: ExplorerDraftConfig;
  hasExistingResults?: boolean;
  onRunComplete?: (
    exploration: ProductAnalyticsExploration,
    comparisonExploration: ProductAnalyticsExploration | null,
    previousTimeFrame: ExplorationDateRange | null,
  ) => void;
  trackingSource?: string;
}

export function ExplorerProvider({
  children,
  initialConfig,
  initialSubmittedConfig,
  hasExistingResults = false,
  onRunComplete,
  trackingSource,
}: ExplorerProviderProps) {
  const { loading, fetchData, fetchExplorationById } = useExploreData();
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
    draftState: ExplorerDraftConfig;
    submittedState: ExplorerDraftConfig | null;
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
    const normalizedSubmitted = initialSubmittedConfig
      ? clearInapplicableShowAs(
          fillMissingUnits(
            initialSubmittedConfig,
            getFactTableById,
            getFactMetricById,
          ),
          getFactMetricById,
        )
      : normalizedInitial;
    return {
      draftState: normalizedInitial,
      submittedState: hasExistingResults ? normalizedSubmitted : null,
      exploration: null,
      error: null,
      query: null,
    };
  });
  const [isStale, setIsStale] = useState(false);
  // True while polling a still-running exploration for completion (B4). Folded
  // into the exposed `loading` so the UI keeps showing a loading state.
  const [polling, setPolling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stop polling if the provider unmounts mid-flight.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);
  const [comparisonExploration, setComparisonExploration] =
    useState<ProductAnalyticsExploration | null>(null);
  const [comparisonQuery, setComparisonQuery] = useState<QueryInterface | null>(
    null,
  );
  const [comparisonComputed, setComparisonComputed] =
    useState<ExplorerContextValue["comparisonComputed"]>(null);

  const normalizedInitialDateRange = useMemo(() => {
    const withUnits = fillMissingUnits(
      initialConfig,
      getFactTableById,
      getFactMetricById,
    );
    return clearInapplicableShowAs(withUnits, getFactMetricById).dateRange;
  }, [initialConfig, getFactTableById, getFactMetricById]);

  const lastCustomPrimaryBoundsRef = useRef<string | null>(
    customPrimaryBoundsKey(normalizedInitialDateRange),
  );

  const hasEverFetchedRef = useRef(hasExistingResults);
  const skipNextAutoSubmitRef = useRef(false);
  const submitRequestIdRef = useRef(0);
  const funnelAnalyzeCollapseRef = useRef<(() => void) | null>(null);

  const draftExploreState: ExplorerDraftConfig = explorerState.draftState;

  const compareEnabled = draftExploreState.previousTimeFrame != null;

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

  const managedWarehouseUnavailable = useMemo(() => {
    if (!draftExploreState.datasource) return false;
    const datasource = datasources.find(
      (d) => d.id === draftExploreState.datasource,
    );
    return datasource ? isManagedWarehouseUnavailable(datasource) : false;
  }, [datasources, draftExploreState.datasource]);

  const setSubmittedExploreState = useCallback((state: ExplorerDraftConfig) => {
    setExplorerState((prev) => ({
      ...prev,
      submittedState: state,
    }));
  }, []);

  const data = explorerState.exploration;
  const error = explorerState.error;
  const submittedExploreState = explorerState.submittedState;
  const query = explorerState.query;

  const submittedPreviousTimeFrame =
    submittedExploreState?.previousTimeFrame ?? null;

  useEffect(() => {
    if (draftExploreState.previousTimeFrame == null) return;

    const dr = draftExploreState.dateRange;
    const customKey = customPrimaryBoundsKey(dr);

    if (customKey !== null) {
      // Seed a sensible default prior only the first time we enter a custom
      // range with none set for it yet. We intentionally don't keep the prior
      // locked to the current range afterward — once seeded, the user can freely
      // adjust it, and changing the current range won't overwrite their choice.
      if (lastCustomPrimaryBoundsRef.current === null) {
        setDraftExploreState((prev) => ({
          ...prev,
          previousTimeFrame: buildContiguousPreviousCustomDateRange(
            dr.startDate as string,
            dr.endDate as string,
            dr.lookbackValue ?? null,
            dr.lookbackUnit ?? null,
          ),
        }));
      }
      lastCustomPrimaryBoundsRef.current = customKey;
      return;
    }

    lastCustomPrimaryBoundsRef.current = null;
    const aligned = buildComparisonDateRange(dr);
    if (!isEqual(draftExploreState.previousTimeFrame, aligned)) {
      setDraftExploreState((prev) => ({
        ...prev,
        previousTimeFrame: aligned,
      }));
    }
  }, [
    draftExploreState.dateRange,
    draftExploreState.previousTimeFrame,
    setDraftExploreState,
  ]);

  const setCompareEnabled = useCallback(
    (value: boolean) => {
      if (value) {
        setDraftExploreState((prev) => ({
          ...prev,
          previousTimeFrame: buildComparisonDateRange(prev.dateRange),
        }));
      } else {
        setDraftExploreState((prev) => {
          const { previousTimeFrame: _, ...rest } = prev;
          return rest;
        });
        setComparisonExploration(null);
        setComparisonQuery(null);
        setComparisonComputed(null);
      }
    },
    [setDraftExploreState],
  );

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
    return compareConfig(baselineConfig, cleanedDraftExploreState, {
      lastPreviousTimeFrame: submittedPreviousTimeFrame,
      newPreviousTimeFrame: draftExploreState.previousTimeFrame ?? null,
    });
  }, [
    baselineConfig,
    cleanedDraftExploreState,
    submittedPreviousTimeFrame,
    draftExploreState.previousTimeFrame,
  ]);

  const isSubmittable = useMemo(() => {
    return (
      isSubmittableConfig(cleanedDraftExploreState, getFactTableById) &&
      // Block submission while alwaysInlineFilter columns are seeded but empty.
      // cleanConfigForSubmission would otherwise strip the placeholder filter
      // and let the query run unfiltered, contradicting the "always filter" intent.
      !hasUnsatisfiedInlineFilters(draftExploreState, getFactTableById)
    );
  }, [cleanedDraftExploreState, draftExploreState, getFactTableById]);

  const doSubmit = useCallback(
    async (options?: { cache?: CacheOption; config?: ExplorerDraftConfig }) => {
      const sourceConfig = options?.config ?? draftExploreState;
      const configToSubmit = cleanConfigForSubmission(sourceConfig);
      const previousForRequest = sourceConfig.previousTimeFrame ?? null;
      if (!isSubmittableConfig(configToSubmit)) return;

      if (managedWarehouseUnavailable) {
        return;
      }

      // When comparison is first enabled, the prior-period query has never
      // been computed. A "required" fetch would return null for it (cache-only)
      // and the comparison would silently stay empty until a page refresh, so
      // run it like a first load instead.
      const enablingComparison =
        previousForRequest != null && submittedPreviousTimeFrame == null;

      let cache: CacheOption;
      if (options?.cache) {
        // explicitly set the cache option
        cache = options.cache;
      } else if (
        !hasEverFetchedRef.current ||
        isManagedWarehouse ||
        enablingComparison
      ) {
        // first load, managed warehouse, or newly-enabled comparison: run if missing
        cache = "preferred";
      } else {
        // otherwise, use required cache
        cache = "required";
      }
      hasEverFetchedRef.current = true;
      const requestId = ++submitRequestIdRef.current;

      setExplorerState((prev) => ({
        ...prev,
        error: null,
      }));

      const startTime = Date.now();
      const {
        data: fetchResult,
        query,
        comparison,
        error: fetchError,
      } = await fetchData(configToSubmit, {
        cache,
        ...(previousForRequest
          ? { previousTimeFrame: previousForRequest }
          : {}),
      });

      // Ignore out-of-order responses from older in-flight requests.
      if (requestId !== submitRequestIdRef.current) return;

      // Cache miss when cache=required
      if (cache === "required" && fetchResult === null && !fetchError) {
        setIsStale(true);
        return;
      }

      const submittedConfig: ExplorerDraftConfig = previousForRequest
        ? { ...configToSubmit, previousTimeFrame: previousForRequest }
        : configToSubmit;

      // Apply a terminal (success or error) result: update state, fire the
      // completion callback, and emit analytics. Shared by the synchronous
      // response and the async poll below so both behave identically.
      const finalize = (
        result: ProductAnalyticsExploration | null,
        resultQuery: QueryInterface | null,
        resultError: string | null,
        resultComparison: ProductAnalyticsExploration | null = comparison?.exploration ??
          null,
        resultComparisonQuery: QueryInterface | null = comparison?.query ??
          null,
        resultComparisonComputed: ExplorerContextValue["comparisonComputed"] = comparison
          ? {
              bigNumberTrends: comparison.bigNumberTrends,
              tableTrendsByRow: comparison.tableTrendsByRow,
              previousPeriod: comparison.previousPeriod,
            }
          : null,
      ) => {
        if (requestId !== submitRequestIdRef.current) return;
        setPolling(false);
        if (result || resultError) {
          setSubmittedExploreState(submittedConfig);
          setIsStale(false);
        }
        setExplorerState((prev) => ({
          ...prev,
          exploration: result,
          query: resultQuery,
          error: resultError || result?.error || null,
        }));
        setComparisonExploration(resultComparison);
        setComparisonQuery(resultComparisonQuery);
        setComparisonComputed(resultComparisonComputed);
        if (result && !resultError) {
          onRunComplete?.(result, resultComparison, previousForRequest);
        }
        if (trackingSource) {
          const datasourceType =
            getDatasourceById(configToSubmit.datasource)?.type ?? null;
          const errorMessage = resultError || result?.error || null;
          const baseProps = {
            source: trackingSource,
            type: configToSubmit.type,
            chart_type: configToSubmit.chartType,
            datasource_type: datasourceType,
            duration_ms: Date.now() - startTime,
            cache,
            num_values:
              configToSubmit.dataset?.type === "funnel"
                ? (configToSubmit.dataset.steps?.length ?? 0)
                : (configToSubmit.dataset?.values?.length ?? 0),
            num_dimensions: configToSubmit.dimensions?.length ?? 0,
          };
          if (errorMessage) {
            track("Product Analytics Explorer: Refresh Failure", {
              ...baseProps,
              error_message: errorMessage.slice(0, MAX_TRACKED_ERROR_LENGTH),
            });
          } else if (result) {
            track("Product Analytics Explorer: Refresh Success", {
              ...baseProps,
              row_count: result.result?.rows?.length ?? 0,
            });
          }
        }
      };

      // Cancel any in-flight poll from a previous submit.
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      const comparisonResult = comparison?.exploration ?? null;
      const primaryIsRunning =
        !fetchError && fetchResult?.status === "running" && !!fetchResult.id;
      const comparisonIsRunning =
        comparisonResult?.status === "running" && !!comparisonResult.id;

      // Primary and comparison explorations run independently. If either
      // exceeds the backend's sync budget, poll both running ids until each is
      // terminal, then rebuild the shared comparison payload from final rows.
      if (primaryIsRunning || comparisonIsRunning) {
        setSubmittedExploreState(submittedConfig);
        setIsStale(false);
        setExplorerState((prev) => ({
          ...prev,
          exploration: primaryIsRunning ? null : fetchResult,
          query: primaryIsRunning ? null : query,
          error: null,
        }));
        setComparisonExploration(comparisonIsRunning ? null : comparisonResult);
        setComparisonQuery(
          comparisonIsRunning ? null : (comparison?.query ?? null),
        );
        setComparisonComputed(null);
        setPolling(true);

        let latestPrimary = fetchResult;
        let latestPrimaryQuery = query;
        let latestPrimaryError = fetchError;
        let latestComparison = comparisonResult;
        let latestComparisonQuery = comparison?.query ?? null;

        const poll = async () => {
          pollTimerRef.current = null;
          if (requestId !== submitRequestIdRef.current) return;

          const primaryPoll =
            latestPrimary?.status === "running" && latestPrimary.id
              ? fetchExplorationById(latestPrimary.id)
              : Promise.resolve(null);
          const comparisonPoll =
            latestComparison?.status === "running" && latestComparison.id
              ? fetchExplorationById(latestComparison.id)
              : Promise.resolve(null);
          const [polledPrimary, polledComparison] = await Promise.all([
            primaryPoll,
            comparisonPoll,
          ]);

          if (polledPrimary) {
            latestPrimary = polledPrimary.data;
            latestPrimaryQuery = polledPrimary.query;
            latestPrimaryError = polledPrimary.error;
          }

          if (polledComparison) {
            latestComparison = polledComparison.data;
            latestComparisonQuery = polledComparison.query;
          }

          if (requestId !== submitRequestIdRef.current) return;

          const primaryStillRunning =
            !latestPrimaryError && latestPrimary?.status === "running";
          const comparisonStillRunning = latestComparison?.status === "running";
          if (primaryStillRunning || comparisonStillRunning) {
            const delay = explorationPollDelayMs(
              Math.floor((Date.now() - startTime) / 1000),
            );
            if (delay <= 0) {
              if (primaryStillRunning) {
                finalize(
                  null,
                  latestPrimaryQuery,
                  "This query is taking longer than expected. Try a shorter date range or fewer steps, then run again.",
                  null,
                  latestComparisonQuery,
                  null,
                );
              } else {
                finalize(
                  latestPrimary,
                  latestPrimaryQuery,
                  latestPrimaryError,
                  null,
                  latestComparisonQuery,
                  null,
                );
              }
              return;
            }
            pollTimerRef.current = setTimeout(poll, delay);
            return;
          }

          const finalComparisonPayload =
            latestPrimary && previousForRequest
              ? computeExplorationComparisonPayload(
                  latestPrimary,
                  latestComparison,
                  configToSubmit,
                  previousForRequest,
                  (id) => getFactMetricById(id) ?? null,
                )
              : null;
          finalize(
            latestPrimary,
            latestPrimaryQuery,
            latestPrimaryError,
            finalComparisonPayload?.exploration ?? latestComparison,
            latestComparisonQuery,
            finalComparisonPayload
              ? {
                  bigNumberTrends: finalComparisonPayload.bigNumberTrends,
                  tableTrendsByRow: finalComparisonPayload.tableTrendsByRow,
                  previousPeriod: finalComparisonPayload.previousPeriod,
                }
              : null,
          );
        };
        pollTimerRef.current = setTimeout(poll, explorationPollDelayMs(0));
        return;
      }

      finalize(fetchResult, query, fetchError);
    },
    [
      draftExploreState,
      submittedPreviousTimeFrame,
      setSubmittedExploreState,
      fetchData,
      fetchExplorationById,
      onRunComplete,
      isManagedWarehouse,
      managedWarehouseUnavailable,
      trackingSource,
      getDatasourceById,
      getFactMetricById,
    ],
  );

  const registerFunnelAnalyzeCollapseHandler = useCallback(
    (fn: (() => void) | null) => {
      funnelAnalyzeCollapseRef.current = fn;
    },
    [],
  );

  const collapseFunnelStepsForAnalyze = useCallback(() => {
    funnelAnalyzeCollapseRef.current?.();
  }, []);

  const handleSubmit = useCallback(
    async (submitOptions?: {
      force?: boolean;
      config?: ExplorerDraftConfig;
      setDraft?: boolean;
    }) => {
      if (submitOptions?.setDraft && submitOptions.config) {
        skipNextAutoSubmitRef.current = true;
        setDraftExploreState(submitOptions.config);
      }

      if (submitOptions?.force) {
        await doSubmit({ cache: "never", config: submitOptions?.config });
      } else {
        await doSubmit({ cache: "preferred", config: submitOptions?.config });
      }
    },
    [doSubmit, setDraftExploreState],
  );

  /** Handle auto-submit based on needsFetch and needsUpdate */
  useEffect(() => {
    if (managedWarehouseUnavailable) return;
    if (!isSubmittable) return;
    if (skipNextAutoSubmitRef.current) {
      skipNextAutoSubmitRef.current = false;
      return;
    }
    const draftIsFunnel = cleanedDraftExploreState.dataset.type === "funnel";
    // Funnels on customer warehouses auto-run as soon as the config becomes
    // fetchable (e.g. second step added), which fires an expensive query.
    // Managed Warehouse stays auto-run — queries are cheap there.
    // Exception: toggling Compare on/off only changes previousTimeFrame — the
    // primary result is already cached, so don't defer.
    const onlyComparisonChanged =
      baselineConfig !== null &&
      isEqual(
        toFetchKey(stripExplorerDraftFields(baselineConfig)),
        toFetchKey(cleanedDraftExploreState),
      );
    const deferFunnelFetchUntilManualRefresh =
      draftIsFunnel &&
      !isManagedWarehouse &&
      needsFetch &&
      !onlyComparisonChanged;

    if (needsFetch) {
      if (deferFunnelFetchUntilManualRefresh) {
        setIsStale(true);
      } else {
        doSubmit();
      }
    } else if (needsUpdate && !needsFetch) {
      const submittedConfig: ExplorerDraftConfig =
        draftExploreState.previousTimeFrame
          ? {
              ...cleanedDraftExploreState,
              previousTimeFrame: draftExploreState.previousTimeFrame,
            }
          : cleanedDraftExploreState;
      setSubmittedExploreState(submittedConfig);
    }
  }, [
    needsFetch,
    needsUpdate,
    doSubmit,
    baselineConfig,
    cleanedDraftExploreState,
    draftExploreState.previousTimeFrame,
    setSubmittedExploreState,
    isSubmittable,
    managedWarehouseUnavailable,
    isManagedWarehouse,
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
      // Funnels don't carry "values"; the FunnelTabContent manages steps
      // directly via setDraftExploreState.
      if (datasetType === "funnel") return;
      setDraftExploreState((prev) => {
        if (
          !prev.dataset ||
          prev.dataset.type === "funnel" ||
          prev.dataset.type !== datasetType
        ) {
          return prev;
        }
        const value = createDefaultValue(datasetType);

        // Generate unique name
        if (value.name) {
          value.name = generateUniqueValueName(value.name, prev.dataset.values);
        }

        // Pre-seed alwaysInlineFilter columns for fact_table values so the
        // user is prompted to fill them in (matches fact-metric authoring UX).
        if (prev.dataset.type === "fact_table" && prev.dataset.factTableId) {
          const ft = getFactTableById(prev.dataset.factTableId);
          if (ft) {
            value.rowFilters = getInitialInlineFilters(ft, value.rowFilters);
          }
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
    [createDefaultValue, setDraftExploreState, getFactTableById],
  );

  const updateValueInDataset = useCallback(
    (index: number, value: ProductAnalyticsValue) => {
      setDraftExploreState((prev) => {
        if (
          !prev.dataset ||
          prev.dataset.type === "funnel" ||
          prev.dataset.type !== value.type
        ) {
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
        if (!prev.dataset || prev.dataset.type === "funnel") {
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

        // Big Number: no dimensions; keep full dataset values unchanged
        if (chartType === "bigNumber") {
          dimensions = [];
          // Funnels don't carry `values` and the bigNumber chart doesn't
          // apply to them anyway; the FunnelGraphTypeSelector doesn't
          // expose bigNumber, but guard defensively in case it slips in.
          if (prev.dataset?.type !== "funnel") {
            const values = prev.dataset?.values ?? [];
            if (values.length > 1) {
              dataset = {
                ...prev.dataset,
                values: values.slice(0, 1),
              } as ExplorationConfig["dataset"];
            }
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
                dateGranularity: "auto",
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
      lastCustomPrimaryBoundsRef.current = null;
      setComparisonExploration(null);
      setComparisonQuery(null);
      setComparisonComputed(null);
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
        const emptyDataset = createEmptyDataset(type);
        // Funnel datasets manage their own initial state (a single empty
        // step) inside createEmptyDataset and have no `values`. For the
        // other dataset types we still want to seed one default value so
        // the sidebar opens with a ready-to-edit row.
        const dataset =
          type === "funnel"
            ? emptyDataset
            : ({
                ...emptyDataset,
                values: [createDefaultValue(type)],
              } as ExplorationConfig["dataset"]);
        return {
          draftState: {
            ...stripExplorerDraftFields(initialConfig),
            datasource: datasourceId,
            dataset,
          } as ExplorerDraftConfig,
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
      loading: loading || polling,
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
      managedWarehouseUnavailable,
      clearAllDatasets,
      query,
      trackingSource,
      registerFunnelAnalyzeCollapseHandler,
      collapseFunnelStepsForAnalyze,
      compareEnabled,
      submittedPreviousTimeFrame,
      comparisonExploration,
      comparisonQuery,
      comparisonComputed,
      setCompareEnabled,
    }),
    [
      addValueToDataset,
      changeChartType,
      clearAllDatasets,
      commonColumns,
      compareEnabled,
      comparisonComputed,
      comparisonExploration,
      comparisonQuery,
      data,
      deleteValueFromDataset,
      draftExploreState,
      error,
      handleSubmit,
      isStale,
      isSubmittable,
      loading,
      polling,
      managedWarehouseUnavailable,
      needsFetch,
      needsUpdate,
      query,
      setCompareEnabled,
      setDraftExploreState,
      submittedExploreState,
      submittedPreviousTimeFrame,
      trackingSource,
      registerFunnelAnalyzeCollapseHandler,
      collapseFunnelStepsForAnalyze,
      updateTimestampColumn,
      updateValueInDataset,
    ],
  );

  return (
    <ExplorerContext.Provider value={value}>
      {draftExploreState.dataset.type === "sql" ? (
        <SqlEditorProvider
          datasourceId={draftExploreState.datasource}
          sql={draftExploreState.dataset.sql}
          initialViewMode={
            draftExploreState.dataset.sql.trim().length > 0 &&
            draftExploreState.dataset.timestampColumn.length > 0 &&
            draftExploreState.dataset.columnTypes[
              draftExploreState.dataset.timestampColumn
            ] === "date" &&
            Object.keys(draftExploreState.dataset.columnTypes).length > 0
              ? "chart"
              : "sql"
          }
        >
          {children}
        </SqlEditorProvider>
      ) : (
        children
      )}
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
