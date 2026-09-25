import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useApi from "@/hooks/useApi";
import { SyntaxFilter, transformQuery } from "@/services/search";
import { useSearchFiltersBase } from "@/components/Search/SearchFilters";
import { toSafeFilterKeys } from "./format";
import { DEFAULT_TIME_RANGES, TimeRangeOption } from "./types";

const SEARCH_DEBOUNCE_MS = 300;

function buildDateRange(
  hours: number,
  endTime: number,
): { startDate: string; endDate: string } {
  const endDate = new Date(endTime);
  const startDate = new Date(endTime - hours * 60 * 60 * 1000);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

export interface BuildParamsInput {
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
  searchTerm: string;
  syntaxFilters: SyntaxFilter[];
  getFilterValue: (field: string) => string;
}

export interface RecordsQueryConfig<TRow, TResponse> {
  /** Endpoint without a query string. */
  endpoint: string;
  filterKeys: string[];
  buildParams: (input: BuildParamsInput) => Record<string, string | undefined>;
  selectRows: (data: TResponse) => TRow[];
  /** Datasource present and supported, and the user may run queries. */
  canRun: boolean;
  /** Run without an explicit Update click. True for managed warehouses. */
  autoRun: boolean;
  /** Gates auto-running until the surface is visible. */
  isActive?: boolean;
  pageSize?: number;
  timeRanges?: TimeRangeOption[];
  defaultRangeHours?: number;
}

export interface UseRecordsQueryResult<TRow, TResponse> {
  rows: TRow[];
  data: TResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isRefreshing: boolean;
  hasRun: boolean;
  canRun: boolean;
  autoRun: boolean;
  refresh: () => void;

  rangeHours: number;
  setRangeHours: (hours: number) => void;
  timeRanges: TimeRangeOption[];

  page: number;
  setPage: (page: number) => void;
  pageSize: number;

  search: {
    searchInputProps: {
      value: string;
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    };
    setSearchValue: (v: string) => void;
    searchTerm: string;
    syntaxFilters: SyntaxFilter[];
    filterKeys: string[];
    dropdownFilterOpen: string;
    setDropdownFilterOpen: (v: string) => void;
    updateQuery: (filter: SyntaxFilter) => void;
  };
}

export default function useRecordsQuery<TRow, TResponse>({
  endpoint,
  filterKeys,
  buildParams,
  selectRows,
  canRun,
  autoRun,
  isActive = true,
  pageSize = 100,
  timeRanges = DEFAULT_TIME_RANGES,
  defaultRangeHours = 24,
}: RecordsQueryConfig<TRow, TResponse>): UseRecordsQueryResult<
  TRow,
  TResponse
> {
  const [rangeHours, setRangeHoursRaw] = useState(defaultRangeHours);
  const [page, setPageRaw] = useState(1);
  // What the box shows, vs. what the query ran with. Typing settles into the
  // second after a pause; picking a filter applies at once. Same split as
  // useFeatureContentSearch.
  const [searchValue, setSearchValue] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const applyNowRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [windowEndTime, setWindowEndTime] = useState(() => Date.now());
  const [stateEndpoint, setStateEndpoint] = useState(endpoint);
  const [committedQs, setCommittedQs] = useState<string | null>(null);
  const [commitRequested, setCommitRequested] = useState(false);
  const endpointIsCurrent = stateEndpoint === endpoint;

  useEffect(() => {
    if (endpointIsCurrent) return;
    setStateEndpoint(endpoint);
    setRangeHoursRaw(defaultRangeHours);
    setPageRaw(1);
    setSearchValue("");
    setAppliedSearch("");
    setWindowEndTime(Date.now());
    setCommittedQs(null);
    setCommitRequested(false);
  }, [defaultRangeHours, endpoint, endpointIsCurrent]);

  useEffect(() => {
    if (searchValue === appliedSearch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = applyNowRef.current ? 0 : SEARCH_DEBOUNCE_MS;
    applyNowRef.current = false;
    debounceRef.current = setTimeout(() => {
      setAppliedSearch(searchValue);
      setPageRaw(1);
      setCommitRequested(true);
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchValue, appliedSearch]);

  const safeFilterKeys = useMemo(
    () => toSafeFilterKeys(filterKeys),
    [filterKeys],
  );

  // Chips and dropdown state follow the box so the UI stays responsive before
  // the query is submitted.
  const liveFilters = useMemo(
    () => transformQuery(searchValue, safeFilterKeys).syntaxFilters,
    [searchValue, safeFilterKeys],
  );

  const parsed = useMemo(() => {
    const { syntaxFilters, searchTerm } = transformQuery(
      appliedSearch,
      safeFilterKeys,
    );
    // parseQuery lowercases field names, but callers look filters up by their
    // configured name (a dimension may be camelCase), so compare case-insensitively.
    const getFilterValue = (field: string) =>
      syntaxFilters.find((f) => f.field.toLowerCase() === field.toLowerCase())
        ?.values[0] ?? "";
    return { syntaxFilters, searchTerm, getFilterValue };
  }, [appliedSearch, safeFilterKeys]);

  // Keep the time window fixed while filtering and paging so every request
  // operates on the same dataset. Update and range changes re-anchor it.
  const draftQs = useMemo(() => {
    const { startDate, endDate } = buildDateRange(rangeHours, windowEndTime);
    const params = buildParams({
      startDate,
      endDate,
      page,
      pageSize,
      searchTerm: parsed.searchTerm,
      syntaxFilters: parsed.syntaxFilters,
      getFilterValue: parsed.getFilterValue,
    });
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") qs.set(key, value);
    }
    return qs.toString();
    // buildParams is typically an inline arrow, so including it would change
    // the key every render. Everything it closes over reaches us through
    // `parsed`, which is in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeHours, windowEndTime, page, pageSize, parsed]);

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
  // customer's warehouse is never hit just by opening the tab. Once it has run
  // once, control changes re-query on their own.
  useEffect(() => {
    if (!canRun || !isActive || !autoRun || !endpointIsCurrent) return;
    if (committedQs !== null) return;
    setWindowEndTime(Date.now());
    setCommitRequested(true);
  }, [canRun, isActive, autoRun, endpointIsCurrent, committedQs]);

  useEffect(() => {
    if (!commitRequested || !isActive || !endpointIsCurrent) return;
    setCommittedQs(draftQs);
    setCommitRequested(false);
  }, [commitRequested, draftQs, endpointIsCurrent, isActive]);

  const refresh = useCallback(() => {
    setWindowEndTime((previous) => Math.max(Date.now(), previous + 1));
    setCommitRequested(true);
  }, []);

  const setRangeHours = useCallback((hours: number) => {
    setRangeHoursRaw(hours);
    setWindowEndTime((previous) => Math.max(Date.now(), previous + 1));
    setPageRaw(1);
    setCommitRequested(true);
  }, []);

  const setPage = useCallback((next: number) => {
    setPageRaw(next);
    setCommitRequested(true);
  }, []);

  const onSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearchValue(e.target.value),
    [],
  );

  // Picking a filter or clearing is a complete action, so it skips the pause.
  const setSearchValueAndSubmit = useCallback((v: string) => {
    applyNowRef.current = true;
    setSearchValue(v);
  }, []);

  const searchInputProps = useMemo(
    () => ({ value: searchValue, onChange: onSearchChange }),
    [searchValue, onSearchChange],
  );

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters: liveFilters,
      setSearchValue: setSearchValueAndSubmit,
    });

  const hasRun = data !== undefined || error !== undefined;

  return {
    rows: data ? selectRows(data) : [],
    data,
    error,
    isLoading: committedQs !== null && !hasRun,
    isRefreshing: isValidating || commitRequested,
    hasRun,
    canRun,
    autoRun,
    refresh,

    rangeHours,
    setRangeHours,
    timeRanges,

    page,
    setPage,
    pageSize,

    search: {
      searchInputProps,
      setSearchValue: setSearchValueAndSubmit,
      searchTerm: parsed.searchTerm,
      syntaxFilters: liveFilters,
      filterKeys: safeFilterKeys,
      dropdownFilterOpen,
      setDropdownFilterOpen,
      updateQuery,
    },
  };
}
