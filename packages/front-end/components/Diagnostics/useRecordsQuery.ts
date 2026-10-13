import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEqual } from "lodash";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import type { ExplorationDateRange } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import { canNarrowLoadedRows } from "@/components/FactTables/rowFilterMatch";
import { useAuth } from "@/services/auth";
import { type ResolvedWindow, windowIsWithinLoaded } from "./recordsWindow";

/** 24 hours back, matching the window these panels opened on before. */
export const DEFAULT_RECORDS_DATE_RANGE: ExplorationDateRange = {
  predefined: "customLookback",
  lookbackValue: 24,
  lookbackUnit: "hour",
};

export type RecordsCacheOption = "preferred" | "required" | "never";

export interface BuildParamsInput {
  startDate: string;
  endDate: string;
  rowFilters: RowFilter[];
  cache: RecordsCacheOption;
}

export interface RecordsQueryMeta {
  truncated: boolean;
  ranAt?: string;
}

export interface RecordsQueryConfig<TRow, TResponse> {
  endpoint: string;
  buildParams: (input: BuildParamsInput) => Record<string, unknown>;
  selectRows: (data: TResponse) => TRow[];
  selectMeta?: (data: TResponse) => RecordsQueryMeta;
  selectNoCachedResult?: (data: TResponse) => boolean;
  /** Datasource present and supported, and the user may run queries. */
  canRun: boolean;
  /** Run without an explicit Refresh. True for managed warehouses. */
  autoRun: boolean;
  /** Gates auto-running until the surface is visible. */
  isActive?: boolean;
  defaultDateRange?: ExplorationDateRange;
}

export interface UseRecordsQueryResult<TRow, TResponse> {
  /** The whole buffer the warehouse returned; filtering happens downstream. */
  rows: TRow[];
  data: TResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  /** Nothing is loaded, nothing is running, and the cache had nothing. */
  isIdle: boolean;
  localNarrowingIsLossy: boolean;
  truncated: boolean;
  ranAt: string | undefined;
  /** Re-runs the query, bypassing the cache, with the current controls. */
  submit: () => void;
  hasPendingChanges: boolean;

  dateRange: ExplorationDateRange;
  rowFilters: RowFilter[];

  applyControls: (next: {
    rowFilters?: RowFilter[];
    dateRange?: ExplorationDateRange;
  }) => void;
  appliedRowFilters: RowFilter[] | null;
  visibleWindow: ResolvedWindow | null;
}

interface RunArgs {
  filters: RowFilter[];
  range: ExplorationDateRange;
  cache: RecordsCacheOption;
}

export default function useRecordsQuery<TRow, TResponse>({
  endpoint,
  buildParams,
  selectRows,
  selectMeta,
  selectNoCachedResult,
  canRun,
  autoRun,
  isActive = true,
  defaultDateRange = DEFAULT_RECORDS_DATE_RANGE,
}: RecordsQueryConfig<TRow, TResponse>): UseRecordsQueryResult<
  TRow,
  TResponse
> {
  const { apiCall } = useAuth();
  const [dateRange, setDateRange] =
    useState<ExplorationDateRange>(defaultDateRange);
  const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);

  const [appliedDateRange, setAppliedDateRange] =
    useState<ExplorationDateRange | null>(null);
  const [appliedRowFilters, setAppliedRowFilters] = useState<
    RowFilter[] | null
  >(null);
  const [appliedWindow, setAppliedWindow] = useState<ResolvedWindow | null>(
    null,
  );
  const [visibleWindow, setVisibleWindow] = useState<ResolvedWindow | null>(
    null,
  );

  const [data, setData] = useState<TResponse>();
  const [error, setError] = useState<Error>();
  const [inFlight, setInFlight] = useState<null | "cache" | "query">(null);
  const [cacheProbe, setCacheProbe] = useState<"pending" | "done">("pending");
  const [stateEndpoint, setStateEndpoint] = useState(endpoint);
  const requestVersion = useRef(0);
  const endpointIsCurrent = stateEndpoint === endpoint;

  const configRef = useRef({
    buildParams,
    selectRows,
    selectMeta,
    selectNoCachedResult,
  });
  configRef.current = {
    buildParams,
    selectRows,
    selectMeta,
    selectNoCachedResult,
  };

  useEffect(() => {
    if (endpointIsCurrent) return;
    requestVersion.current++;
    setStateEndpoint(endpoint);
    setDateRange(defaultDateRange);
    setRowFilters([]);
    setAppliedDateRange(null);
    setAppliedRowFilters(null);
    setAppliedWindow(null);
    setVisibleWindow(null);
    setData(undefined);
    setError(undefined);
    setInFlight(null);
    setCacheProbe("pending");
  }, [defaultDateRange, endpoint, endpointIsCurrent]);

  const run = useCallback(
    ({ filters, range, cache }: RunArgs) => {
      if (!canRun || !isActive || !endpointIsCurrent) return;

      const resolvedRange = calculateProductAnalyticsDateRange(range);
      const resolved: ResolvedWindow = {
        startDate: resolvedRange.startDate.toISOString(),
        endDate: resolvedRange.endDate.toISOString(),
      };
      const version = ++requestVersion.current;

      setError(undefined);
      setInFlight(cache === "required" ? "cache" : "query");

      apiCall<TResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(
          configRef.current.buildParams({
            startDate: resolved.startDate,
            endDate: resolved.endDate,
            rowFilters: filters,
            cache,
          }),
        ),
      })
        .then((response) => {
          if (requestVersion.current !== version) return;
          if (configRef.current.selectNoCachedResult?.(response)) return;
          setData(response);
          setAppliedDateRange(range);
          setAppliedRowFilters(filters);
          setAppliedWindow(resolved);
          setVisibleWindow(null);
        })
        .catch((e: unknown) => {
          if (requestVersion.current !== version) return;
          setError(
            e instanceof Error ? e : new Error("Could not load records."),
          );
        })
        .finally(() => {
          if (requestVersion.current !== version) return;
          setInFlight(null);
          // Unconditional, including for a request that raced ahead of the
          // probe — otherwise the probe effect fires once this one lands.
          setCacheProbe("done");
        });
    },
    [apiCall, canRun, endpoint, endpointIsCurrent, isActive],
  );

  useEffect(() => {
    if (!canRun || !isActive || !endpointIsCurrent) return;
    if (cacheProbe !== "pending" || inFlight !== null) return;
    run({ filters: [], range: defaultDateRange, cache: "required" });
  }, [
    canRun,
    isActive,
    endpointIsCurrent,
    cacheProbe,
    inFlight,
    defaultDateRange,
    run,
  ]);

  useEffect(() => {
    if (!canRun || !isActive || !autoRun || !endpointIsCurrent) return;
    if (cacheProbe !== "done" || inFlight !== null) return;
    if (data !== undefined || error !== undefined) return;
    run({ filters: rowFilters, range: dateRange, cache: "preferred" });
  }, [
    canRun,
    isActive,
    autoRun,
    endpointIsCurrent,
    cacheProbe,
    inFlight,
    data,
    error,
    rowFilters,
    dateRange,
    run,
  ]);

  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );

  const rows = useMemo(
    () => (data ? configRef.current.selectRows(data) : []),
    [data],
  );
  const meta = useMemo(
    () => (data ? configRef.current.selectMeta?.(data) : undefined),
    [data],
  );
  const truncated = meta?.truncated ?? false;

  const submit = useCallback(() => {
    if (inFlight !== null) return;
    run({ filters: rowFilters, range: dateRange, cache: "never" });
  }, [dateRange, inFlight, rowFilters, run]);

  const filtersCanNarrow = canNarrowLoadedRows({
    loadedFilters: appliedRowFilters,
    nextFilters: rowFilters,
    truncated,
  });

  const applyControls = useCallback(
    (next: { rowFilters?: RowFilter[]; dateRange?: ExplorationDateRange }) => {
      const filters = next.rowFilters ?? rowFilters;
      const range = next.dateRange ?? dateRange;
      if (next.rowFilters) setRowFilters(next.rowFilters);
      if (next.dateRange) setDateRange(next.dateRange);
      if (inFlight !== null) return;

      const sameRange = isEqual(range, appliedDateRange);
      let nextWindow: ResolvedWindow | null = visibleWindow;
      let rangeCanNarrow = sameRange;
      if (!sameRange && appliedWindow !== null && !truncated) {
        const resolvedRange = calculateProductAnalyticsDateRange(range);
        const candidate: ResolvedWindow = {
          startDate: resolvedRange.startDate.toISOString(),
          endDate: resolvedRange.endDate.toISOString(),
        };
        if (
          windowIsWithinLoaded(candidate, appliedWindow, {
            allowStaleEnd: range.predefined !== "customDateRange",
          })
        ) {
          nextWindow = candidate;
          rangeCanNarrow = true;
        }
      }

      const canNarrow =
        rangeCanNarrow &&
        canNarrowLoadedRows({
          loadedFilters: appliedRowFilters,
          nextFilters: filters,
          truncated,
        });

      if (canNarrow) {
        setAppliedDateRange(range);
        setVisibleWindow(nextWindow);
        return;
      }
      if (appliedRowFilters !== null) {
        run({ filters, range, cache: "preferred" });
      }
    },
    [
      appliedDateRange,
      appliedRowFilters,
      appliedWindow,
      dateRange,
      inFlight,
      rowFilters,
      run,
      truncated,
      visibleWindow,
    ],
  );

  const hasRun = data !== undefined || error !== undefined;

  return {
    rows,
    data,
    error,
    isLoading: inFlight !== null && !hasRun,
    isRefreshing: inFlight !== null,
    isIdle: (cacheProbe === "done" || !canRun) && inFlight === null && !hasRun,
    localNarrowingIsLossy:
      inFlight === null && appliedRowFilters !== null && !filtersCanNarrow,
    truncated,
    ranAt: meta?.ranAt,
    submit,
    hasPendingChanges:
      appliedDateRange !== null && !isEqual(dateRange, appliedDateRange),

    dateRange,
    rowFilters,
    applyControls,
    appliedRowFilters,
    visibleWindow,
  };
}
