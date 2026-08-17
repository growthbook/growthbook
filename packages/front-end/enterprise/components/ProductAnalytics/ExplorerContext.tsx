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
  datasetHasValues,
  datasetTypeHasValues,
  ProductAnalyticsExploration,
  ExplorationDateRange,
  MAX_JOURNEY_PATH_LENGTH,
  type ComparisonMode,
  type ProductAnalyticsRunComparisonPayload,
} from "shared/validators";
import { QueryInterface } from "shared/types/query";
import {
  buildComparisonDateRangeForMode,
  computeExplorationComparisonPayload,
  getComparisonAlignmentStrategy,
  resolveLegacyExplorerComparisonMode,
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
import {
  journeyFetchCache,
  journeyShouldPrefetchMore,
} from "@/enterprise/components/ProductAnalytics/journey-policy";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExploreData, CacheOption } from "./useExploreData";

const MAX_TRACKED_ERROR_LENGTH = 500;

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
  comparisonMode: ComparisonMode;
  submittedComparisonMode: ComparisonMode | null;
  submittedPreviousTimeFrame: ExplorationDateRange | null;
  comparisonExploration: ProductAnalyticsExploration | null;
  comparisonQuery: QueryInterface | null;
  comparisonComputed: Pick<
    ProductAnalyticsRunComparisonPayload,
    "bigNumberTrends" | "tableTrendsByRow" | "previousPeriod"
  > | null;
  /** Comparison leg failed but the primary succeeded. Kept off `error`, which
   * would hide the results the user did get. */
  comparisonError: string | null;
  setCompareEnabled: (value: boolean) => void;
  setComparisonMode: (mode: ComparisonMode) => void;

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
  commitJourneyStep: (value: string) => void;
  popJourneyPath: (index: number) => void;
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
    comparisonMode: ComparisonMode | null,
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
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const hasEverFetchedRef = useRef(hasExistingResults);
  const skipNextAutoSubmitRef = useRef(false);
  const submitRequestIdRef = useRef(0);
  const funnelAnalyzeCollapseRef = useRef<(() => void) | null>(null);

  const draftExploreState: ExplorerDraftConfig = explorerState.draftState;

  const compareEnabled = draftExploreState.previousTimeFrame != null;

  const comparisonMode: ComparisonMode =
    draftExploreState.comparisonMode ??
    resolveLegacyExplorerComparisonMode(draftExploreState.dateRange);

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
  const submittedComparisonMode = submittedExploreState?.previousTimeFrame
    ? (submittedExploreState.comparisonMode ??
      resolveLegacyExplorerComparisonMode(submittedExploreState.dateRange))
    : null;

  // Keep the derived window in step with the primary range. `custom` is the one
  // mode the user owns outright, so it is never overwritten here.
  useEffect(() => {
    if (draftExploreState.previousTimeFrame == null) return;
    if (comparisonMode === "custom") return;

    const aligned = buildComparisonDateRangeForMode(
      draftExploreState.dateRange,
      comparisonMode,
    );
    if (!isEqual(draftExploreState.previousTimeFrame, aligned)) {
      setDraftExploreState((prev) => ({
        ...prev,
        previousTimeFrame: aligned,
      }));
    }
  }, [
    draftExploreState.dateRange,
    draftExploreState.previousTimeFrame,
    comparisonMode,
    setDraftExploreState,
  ]);

  const setCompareEnabled = useCallback(
    (value: boolean) => {
      if (value) {
        setDraftExploreState((prev) => ({
          ...prev,
          comparisonMode: "previousPeriod",
          previousTimeFrame: buildComparisonDateRangeForMode(
            prev.dateRange,
            "previousPeriod",
          ),
        }));
      } else {
        setDraftExploreState((prev) => {
          const { previousTimeFrame: _, comparisonMode: __, ...rest } = prev;
          return rest;
        });
        setComparisonExploration(null);
        setComparisonQuery(null);
        setComparisonComputed(null);
        setComparisonError(null);
      }
    },
    [setDraftExploreState],
  );

  const setComparisonMode = useCallback(
    (mode: ComparisonMode) => {
      setDraftExploreState((prev) => ({
        ...prev,
        comparisonMode: mode,
        // Seeding `custom` from the window already on screen keeps the manual
        // field from jumping the moment it becomes editable.
        previousTimeFrame: buildComparisonDateRangeForMode(
          prev.dateRange,
          mode,
          prev.previousTimeFrame ?? null,
        ),
      }));
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
    return compareConfig(
      baselineConfig,
      cleanedDraftExploreState,
      {
        lastPreviousTimeFrame: submittedPreviousTimeFrame,
        newPreviousTimeFrame: draftExploreState.previousTimeFrame ?? null,
        lastComparisonMode: submittedComparisonMode,
        newComparisonMode: compareEnabled ? comparisonMode : null,
      },
      {
        rowSource:
          data?.config.dataset.type === "journey"
            ? data.config
            : baselineConfig,
        rows: data?.result?.rows ?? [],
      },
    );
  }, [
    baselineConfig,
    cleanedDraftExploreState,
    submittedPreviousTimeFrame,
    draftExploreState.previousTimeFrame,
    submittedComparisonMode,
    compareEnabled,
    comparisonMode,
    data,
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
      const modeForRequest = previousForRequest
        ? (sourceConfig.comparisonMode ??
          resolveLegacyExplorerComparisonMode(sourceConfig.dateRange))
        : null;
      if (!isSubmittableConfig(configToSubmit)) return;

      if (managedWarehouseUnavailable) {
        return;
      }

      // When comparison is first enabled — or switched to a mode whose window
      // has never been computed — the prior-period query doesn't exist yet. A
      // "required" fetch would return null for it (cache-only) and the
      // comparison would silently stay empty until a page refresh, so run it
      // like a first load instead.
      const enablingComparison =
        previousForRequest != null &&
        (submittedPreviousTimeFrame == null ||
          modeForRequest !== submittedComparisonMode);

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
          ? {
              previousTimeFrame: previousForRequest,
              comparisonMode: modeForRequest,
            }
          : {}),
      });

      // Ignore out-of-order responses from older in-flight requests.
      if (requestId !== submitRequestIdRef.current) return;

      // Cache miss when cache=required
      if (cache === "required" && fetchResult === null && !fetchError) {
        setIsStale(true);
        return;
      }

      const submittedConfig: ExplorerDraftConfig =
        previousForRequest && modeForRequest
          ? {
              ...configToSubmit,
              previousTimeFrame: previousForRequest,
              comparisonMode: modeForRequest,
            }
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
        const nextError = resultError || result?.error || null;
        const failedWithoutRows =
          !!nextError && (result?.result?.rows?.length ?? 0) === 0;
        const hasTerminalResult = !!result || !!resultError;
        if (hasTerminalResult) {
          setIsStale(false);
        }
        setExplorerState((prev) => {
          const keepPrevious =
            failedWithoutRows &&
            (prev.exploration?.result?.rows?.length ?? 0) > 0;
          return {
            ...prev,
            submittedState:
              hasTerminalResult && !keepPrevious
                ? submittedConfig
                : prev.submittedState,
            exploration: keepPrevious ? prev.exploration : result,
            query: keepPrevious ? prev.query : resultQuery,
            error: nextError,
          };
        });
        setComparisonExploration(resultComparison);
        setComparisonQuery(resultComparisonQuery);
        setComparisonComputed(resultComparisonComputed);
        setComparisonError(comparison?.error ?? null);
        if (result && !resultError) {
          onRunComplete?.(
            result,
            resultComparison,
            previousForRequest,
            modeForRequest,
          );
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
                : configToSubmit.dataset?.type === "journey"
                  ? configToSubmit.dataset.path.length
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
        const preserveVisibleResultWhileRunning =
          configToSubmit.dataset.type === "journey";
        if (!preserveVisibleResultWhileRunning) {
          setSubmittedExploreState(submittedConfig);
          setIsStale(false);
        }
        setExplorerState((prev) => ({
          ...prev,
          exploration: primaryIsRunning
            ? preserveVisibleResultWhileRunning
              ? prev.exploration
              : null
            : fetchResult,
          query: primaryIsRunning ? null : query,
          error: null,
        }));
        setComparisonExploration(comparisonIsRunning ? null : comparisonResult);
        setComparisonQuery(
          comparisonIsRunning ? null : (comparison?.query ?? null),
        );
        setComparisonComputed(null);
        setComparisonError(comparison?.error ?? null);
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
                  // Same strategy as the sync path; the default calendar-year
                  // probe pairs weekday-shifted modes one bucket off.
                  getComparisonAlignmentStrategy(
                    modeForRequest ?? "previousPeriod",
                  ),
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
      submittedComparisonMode,
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
    // Funnels on customer warehouses wait for a manual refresh instead of
    // auto-running an expensive query. Managed Warehouse stays auto-run.
    const onlyComparisonChanged =
      baselineConfig !== null &&
      isEqual(
        toFetchKey(stripExplorerDraftFields(baselineConfig)),
        toFetchKey(cleanedDraftExploreState),
      );
    const deferUntilManualRefresh =
      draftIsFunnel &&
      !isManagedWarehouse &&
      needsFetch &&
      !onlyComparisonChanged;
    const rowSourceConfig =
      data?.config.dataset.type === "journey" ? data.config : baselineConfig;
    const journeyCache = journeyFetchCache(
      rowSourceConfig,
      cleanedDraftExploreState,
    );

    if (needsFetch) {
      if (journeyCache) {
        doSubmit({ cache: journeyCache });
      } else if (deferUntilManualRefresh) {
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
              comparisonMode,
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
    comparisonMode,
    setSubmittedExploreState,
    isSubmittable,
    managedWarehouseUnavailable,
    isManagedWarehouse,
    data,
  ]);

  // Journey lookahead top-up: the drawn frontier is served from the current
  // result, but the stored lookahead is nearly spent, so fetch deeper in the
  // background before the next drill-down has to block on a query.
  //
  // This effect can re-arm on any `data` change, so it needs an explicit stop:
  // without one, a prefetch that fails (or returns a cached result whose path
  // still trails the draft) leaves every condition true and the effect fires
  // again on each render. Keying on fetch identity + the drilled path gives one
  // attempt per distinct target; drilling further or editing re-opens it.
  const prefetchAttemptedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (managedWarehouseUnavailable || !isSubmittable) return;
    if (loading || polling) return;
    if (needsFetch) return;
    if (error) return;
    if (cleanedDraftExploreState.dataset.type !== "journey") return;
    const rowSource =
      data?.config.dataset.type === "journey" ? data.config : null;
    if (!journeyShouldPrefetchMore(rowSource, cleanedDraftExploreState)) {
      return;
    }
    const target = JSON.stringify([
      toFetchKey(cleanedDraftExploreState),
      cleanedDraftExploreState.dataset.path,
    ]);
    if (prefetchAttemptedForRef.current === target) return;
    prefetchAttemptedForRef.current = target;
    doSubmit({ cache: "preferred" });
  }, [
    managedWarehouseUnavailable,
    isSubmittable,
    loading,
    polling,
    needsFetch,
    error,
    data,
    cleanedDraftExploreState,
    doSubmit,
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
      if (!datasetTypeHasValues(datasetType)) return;
      setDraftExploreState((prev) => {
        if (
          !datasetHasValues(prev.dataset) ||
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
          !datasetHasValues(prev.dataset) ||
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
        if (!datasetHasValues(prev.dataset)) {
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
          if (datasetHasValues(prev.dataset)) {
            const values = prev.dataset.values;
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

  const commitJourneyStep = useCallback(
    (value: string) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== "journey") return prev;
        if (prev.dataset.path.length >= MAX_JOURNEY_PATH_LENGTH) return prev;
        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            path: [...prev.dataset.path, { value }],
          },
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  const popJourneyPath = useCallback(
    (index: number) => {
      setDraftExploreState((prev) => {
        if (prev.dataset.type !== "journey") return prev;
        return {
          ...prev,
          dataset: {
            ...prev.dataset,
            path: prev.dataset.path.slice(0, index),
          },
        } as ExplorationConfig;
      });
    },
    [setDraftExploreState],
  );

  const clearAllDatasets = useCallback(
    (newDatasourceId?: string) => {
      setComparisonExploration(null);
      setComparisonQuery(null);
      setComparisonComputed(null);
      setComparisonError(null);
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
        const dataset = !datasetTypeHasValues(type)
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
      commitJourneyStep,
      popJourneyPath,
      compareEnabled,
      comparisonMode,
      submittedComparisonMode,
      submittedPreviousTimeFrame,
      comparisonExploration,
      comparisonQuery,
      comparisonComputed,
      comparisonError,
      setCompareEnabled,
      setComparisonMode,
    }),
    [
      addValueToDataset,
      changeChartType,
      clearAllDatasets,
      commonColumns,
      compareEnabled,
      comparisonMode,
      submittedComparisonMode,
      setComparisonMode,
      comparisonComputed,
      comparisonError,
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
      commitJourneyStep,
      popJourneyPath,
      updateTimestampColumn,
      updateValueInDataset,
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
