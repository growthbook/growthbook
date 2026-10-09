import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isEqual } from "lodash";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import type { ExplorationDateRange } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import { useAuth } from "@/services/auth";

/** 24 hours back, matching the window these panels opened on before. */
export const DEFAULT_RECORDS_DATE_RANGE: ExplorationDateRange = {
  predefined: "customLookback",
  lookbackValue: 24,
  lookbackUnit: "hour",
};

export interface BuildParamsInput {
  startDate: string;
  endDate: string;
  rowFilters: RowFilter[];
}

export interface RecordsQueryConfig<TRow, TResponse> {
  endpoint: string;
  buildParams: (input: BuildParamsInput) => Record<string, unknown>;
  selectRows: (data: TResponse) => TRow[];
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
  hasRun: boolean;
  canRun: boolean;
  autoRun: boolean;
  /** Re-queries the warehouse with the staged range and the applied filters. */
  submit: () => void;
  /** Staged edits the last query did not see. */
  hasPendingChanges: boolean;

  /** Staged: takes effect on the next submit, not on selection. */
  dateRange: ExplorationDateRange;
  setDateRange: (range: ExplorationDateRange) => void;

  /**
   * Applied filters. They narrow the loaded rows immediately; the warehouse
   * only sees them on the next submit.
   */
  rowFilters: RowFilter[];
  setRowFilters: (filters: RowFilter[]) => void;
  submittedRowFilters: RowFilter[];
}

export default function useRecordsQuery<TRow, TResponse>({
  endpoint,
  buildParams,
  selectRows,
  canRun,
  autoRun,
  isActive = true,
  defaultDateRange = DEFAULT_RECORDS_DATE_RANGE,
}: RecordsQueryConfig<TRow, TResponse>): UseRecordsQueryResult<
  TRow,
  TResponse
> {
  const { apiCall } = useAuth();
  // Every control is staged: what the controls show, vs. what the query
  // actually ran with. Only submit closes the gap, so a customer's warehouse is
  // never billed for a dropdown pick.
  const [dateRange, setDateRange] =
    useState<ExplorationDateRange>(defaultDateRange);
  const [submittedDateRange, setSubmittedDateRange] =
    useState<ExplorationDateRange>(defaultDateRange);
  const [rowFilters, setRowFilters] = useState<RowFilter[]>([]);
  const [submittedRowFilters, setSubmittedRowFilters] = useState<RowFilter[]>(
    [],
  );
  const [data, setData] = useState<TResponse>();
  const [error, setError] = useState<Error>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stateEndpoint, setStateEndpoint] = useState(endpoint);
  const requestVersion = useRef(0);
  const endpointIsCurrent = stateEndpoint === endpoint;

  useEffect(() => {
    if (endpointIsCurrent) return;
    requestVersion.current++;
    setStateEndpoint(endpoint);
    setDateRange(defaultDateRange);
    setSubmittedDateRange(defaultDateRange);
    setRowFilters([]);
    setSubmittedRowFilters([]);
    setData(undefined);
    setError(undefined);
    setIsRefreshing(false);
  }, [defaultDateRange, endpoint, endpointIsCurrent]);

  const submit = useCallback(() => {
    if (!canRun || !isActive || !endpointIsCurrent) return;

    const resolved = calculateProductAnalyticsDateRange(dateRange);
    const window = {
      startDate: resolved.startDate.toISOString(),
      endDate: resolved.endDate.toISOString(),
    };
    const filters = rowFilters;
    const version = ++requestVersion.current;

    setSubmittedDateRange(dateRange);
    setSubmittedRowFilters(filters);
    setError(undefined);
    setIsRefreshing(true);

    apiCall<TResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(
        buildParams({
          startDate: window.startDate,
          endDate: window.endDate,
          rowFilters: filters,
        }),
      ),
    })
      .then((response) => {
        if (requestVersion.current !== version) return;
        setData(response);
      })
      .catch((e: unknown) => {
        if (requestVersion.current !== version) return;
        setError(e instanceof Error ? e : new Error("Could not load records."));
      })
      .finally(() => {
        if (requestVersion.current !== version) return;
        setIsRefreshing(false);
      });
  }, [
    apiCall,
    buildParams,
    canRun,
    dateRange,
    endpoint,
    endpointIsCurrent,
    isActive,
    rowFilters,
  ]);

  // Only the first load is automatic, and only where compute is ours, so a
  // customer's warehouse is never hit just by opening the tab. Goes through
  // submit so the window is resolved in exactly one place.
  useEffect(() => {
    if (!canRun || !isActive || !autoRun || !endpointIsCurrent) return;
    if (data !== undefined || error !== undefined || isRefreshing) return;
    submit();
  }, [
    canRun,
    isActive,
    autoRun,
    endpointIsCurrent,
    data,
    error,
    isRefreshing,
    submit,
  ]);

  useEffect(
    () => () => {
      requestVersion.current++;
    },
    [],
  );

  const rows = useMemo(
    () => (data ? selectRows(data) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const hasRun = data !== undefined || error !== undefined;
  const hasPendingChanges =
    !isEqual(dateRange, submittedDateRange) ||
    !isEqual(rowFilters, submittedRowFilters);

  return {
    rows,
    data,
    error,
    isLoading: isRefreshing && !hasRun,
    isRefreshing,
    hasRun,
    canRun,
    autoRun,
    submit,
    hasPendingChanges,

    dateRange,
    setDateRange,
    rowFilters,
    setRowFilters,
    submittedRowFilters,
  };
}
