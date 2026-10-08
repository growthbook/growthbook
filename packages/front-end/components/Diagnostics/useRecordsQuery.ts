import { useCallback, useEffect, useMemo, useState } from "react";
import { isEqual } from "lodash";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import type { ExplorationDateRange } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import useApi from "@/hooks/useApi";

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
  /** Endpoint without a query string. */
  endpoint: string;
  buildParams: (input: BuildParamsInput) => Record<string, string | undefined>;
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
  const [stateEndpoint, setStateEndpoint] = useState(endpoint);
  const [committedQs, setCommittedQs] = useState<string | null>(null);
  const [commitRequested, setCommitRequested] = useState(false);
  const endpointIsCurrent = stateEndpoint === endpoint;

  useEffect(() => {
    if (endpointIsCurrent) return;
    setStateEndpoint(endpoint);
    setDateRange(defaultDateRange);
    setSubmittedDateRange(defaultDateRange);
    setRowFilters([]);
    setSubmittedRowFilters([]);
    setCommittedQs(null);
    setCommitRequested(false);
  }, [defaultDateRange, endpoint, endpointIsCurrent]);

  // Built only from submitted state, never from staged controls.
  const submittedQs = useMemo(() => {
    const resolved = calculateProductAnalyticsDateRange(submittedDateRange);
    const params = buildParams({
      startDate: resolved.startDate.toISOString(),
      endDate: resolved.endDate.toISOString(),
      rowFilters: submittedRowFilters,
    });
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") qs.set(key, value);
    }
    return qs.toString();
    // buildParams is typically an inline arrow, so including it would change
    // the key every render. Everything it reads is in the dep list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedDateRange, submittedRowFilters]);

  const { data, error, isValidating } = useApi<TResponse>(
    `${endpoint}?${committedQs}`,
    {
      shouldRun: () =>
        canRun && isActive && endpointIsCurrent && committedQs !== null,
      // Never re-hit the warehouse just because the window regained focus.
      autoRevalidate: false,
    },
  );

  // Only the first load is automatic, and only where compute is ours, so a
  // customer's warehouse is never hit just by opening the tab.
  useEffect(() => {
    if (!canRun || !isActive || !autoRun || !endpointIsCurrent) return;
    if (committedQs !== null) return;
    setCommitRequested(true);
  }, [canRun, isActive, autoRun, endpointIsCurrent, committedQs]);

  // Runs after the staged values have landed in submitted state, so the
  // committed query string is the one the user actually asked for.
  useEffect(() => {
    if (!commitRequested || !isActive || !endpointIsCurrent) return;
    setCommittedQs(submittedQs);
    setCommitRequested(false);
  }, [commitRequested, submittedQs, endpointIsCurrent, isActive]);

  const submit = useCallback(() => {
    setSubmittedDateRange(dateRange);
    setSubmittedRowFilters(rowFilters);
    setCommitRequested(true);
  }, [dateRange, rowFilters]);

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
    isLoading: committedQs !== null && !hasRun,
    isRefreshing: isValidating || commitRequested,
    hasRun,
    canRun,
    autoRun,
    submit,
    hasPendingChanges,

    dateRange,
    setDateRange,
    rowFilters,
    setRowFilters,
  };
}
