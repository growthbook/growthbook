import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { isEqual } from "lodash";
import { PiArrowsClockwise, PiMagnifyingGlass } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import DateRangeCompareDropdown from "@/enterprise/components/ProductAnalytics/DateRangeCompareDropdown";
import LoadingSpinner from "@/components/LoadingSpinner";
import { RowFilterPanel } from "@/components/FactTables/RowFilterPanel";
import {
  applyRowFilters,
  type RowValueAccessor,
} from "@/components/FactTables/rowFilterMatch";
import type { FilterColumnSource } from "@/components/FactTables/rowFilterUtils";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Pagination from "@/ui/Pagination";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import CollapsibleSidePanel from "./CollapsibleSidePanel";
import ExpandableTable from "./ExpandableTable";
import RowsPerPageSelect from "./RowsPerPageSelect";
import { RecordsColumn } from "./types";
import { UseRecordsQueryResult } from "./useRecordsQuery";

const DEFAULT_ROWS_PER_PAGE = 15;

export interface RecordsPanelProps<TRow extends object, TResponse> {
  title: string;
  query: UseRecordsQueryResult<TRow, TResponse>;

  columns: RecordsColumn<TRow>[];
  getRowId: (row: TRow, index: number) => string;
  /** The text the search box matches against, usually the row's visible cells. */
  getSearchText: (row: TRow) => string;
  /** Reads the value a filter's column names out of a row. */
  getFilterValue: RowValueAccessor<TRow>;
  /** Columns and their values, for the filter panel's pickers. */
  columnSource: FilterColumnSource;

  renderDetail?: (row: TRow) => ReactNode;
  detailFlattenKeys?: string[];
  detailTitle?: string;

  searchPlaceholder?: string;
  /** When the displayed results were produced. */
  lastUpdated?: string | Date | null;
  /** The window held more rows than the query returned. */
  truncated?: boolean;

  emptyMessage?: string;
  /** Shown before the first run when the caller waits for an explicit Refresh. */
  idleMessage?: string;
  /**
   * Rendered above the table as-is, e.g. a warehouse error returned in a 200.
   * Callers own the presentation so they can supply their own Callout.
   */
  warning?: ReactNode;
  headerActions?: ReactNode;
  /** Height cap for the scrolling table body. */
  tableMaxHeight?: number;
}

export default function RecordsPanel<TRow extends object, TResponse>({
  title,
  query,
  columns,
  getRowId,
  getSearchText,
  getFilterValue,
  columnSource,
  renderDetail,
  detailFlattenKeys,
  detailTitle,
  searchPlaceholder = "Search...",
  lastUpdated,
  truncated,
  emptyMessage = "No records found for this time range.",
  idleMessage = "Click Refresh to load records.",
  warning,
  headerActions,
  tableMaxHeight = 480,
}: RecordsPanelProps<TRow, TResponse>) {
  const {
    rows,
    error,
    isLoading,
    isRefreshing,
    hasRun,
    autoRun,
    submit,
    hasPendingChanges,
    dateRange,
    setDateRange,
    rowFilters,
    setRowFilters,
    submittedRowFilters,
  } = query;

  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [page, setPage] = useState(1);

  const filtersAreServerApplied = isEqual(rowFilters, submittedRowFilters);

  // Search and filters narrow what is already loaded, so neither costs a query.
  const visibleRows = useMemo(() => {
    const filtered = filtersAreServerApplied
      ? rows
      : applyRowFilters(rows, rowFilters, getFilterValue);
    const term = search.trim().toLowerCase();
    if (!term) return filtered;
    return filtered.filter((row) =>
      getSearchText(row).toLowerCase().includes(term),
    );
  }, [
    rows,
    rowFilters,
    filtersAreServerApplied,
    search,
    getFilterValue,
    getSearchText,
  ]);

  // Narrowing the results can leave the current page past the end.
  useEffect(() => setPage(1), [visibleRows.length, rowsPerPage]);

  const pageRows = useMemo(
    () => visibleRows.slice((page - 1) * rowsPerPage, page * rowsPerPage),
    [visibleRows, page, rowsPerPage],
  );

  const narrowedLocally = !filtersAreServerApplied || search.trim().length > 0;

  const filterPanel = (
    <Flex direction="column" gap="4" height="100%">
      <Flex direction="column" gap="2">
        <Text weight="medium">Timeframe</Text>
        <DateRangeCompareDropdown
          value={{ dateRange, comparison: null }}
          onChange={(next) => setDateRange(next.dateRange)}
          fullWidth
        />
      </Flex>
      <RowFilterPanel
        value={rowFilters}
        setValue={setRowFilters}
        columnSource={columnSource}
      />
    </Flex>
  );

  return (
    // px/py match the p-3 density of the neighbouring health cards, which is
    // tighter than Frame's default.
    <Frame px="4" py="4" my="4">
      <Flex justify="between" align="center" gap="3" mb="3" wrap="wrap">
        <Heading as="h2" size="lg" mb="0">
          {title}
        </Heading>
        <Flex gap="3" align="center" wrap="wrap">
          {headerActions}
          {lastUpdated && (
            <Tooltip content={datetime(lastUpdated)}>
              <Text
                size="sm"
                color={hasPendingChanges ? "text-mid" : "text-low"}
              >
                {hasPendingChanges
                  ? "Changes not applied"
                  : `Updated ${ago(lastUpdated).replace("about ", "")}`}
              </Text>
            </Tooltip>
          )}
          <Button
            // Solid while staged changes are unapplied, so the control that
            // runs the query is the one that looks pending.
            variant={hasPendingChanges ? "solid" : "soft"}
            size="sm"
            loading={isRefreshing}
            onClick={submit}
            icon={<PiArrowsClockwise />}
          >
            Refresh
          </Button>
        </Flex>
      </Flex>

      <Box mb="3">
        <TextField
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          prepend={<PiMagnifyingGlass aria-hidden />}
        />
      </Box>

      <CollapsibleSidePanel panel={filterPanel} label="filters">
        {warning && <Box mb="3">{warning}</Box>}
        {error && (
          <Callout status="error" size="sm" mb="3">
            {error.message}
          </Callout>
        )}
        {truncated && (
          <Callout status="info" size="sm" mb="3">
            This range holds more rows than were loaded, so counts and pages
            cover the most recent ones only. Narrow the timeframe to see the
            rest.
            {narrowedLocally
              ? " Search and unapplied filters look at the loaded rows alone — refresh to apply filters across the whole timeframe."
              : ""}
          </Callout>
        )}

        {!hasRun && !autoRun && !isRefreshing ? (
          <Text size="sm" color="text-low">
            {idleMessage}
          </Text>
        ) : isLoading ? (
          <LoadingSpinner />
        ) : rows.length === 0 && !error ? (
          <Text size="sm" color="text-low">
            {emptyMessage}
          </Text>
        ) : (
          <>
            {visibleRows.length === 0 ? (
              <Text size="sm" color="text-low">
                No records match the current search and filters.
              </Text>
            ) : (
              <ExpandableTable
                rows={pageRows}
                columns={columns}
                getRowId={getRowId}
                renderDetail={renderDetail}
                detailFlattenKeys={detailFlattenKeys}
                detailTitle={detailTitle}
                maxHeight={tableMaxHeight}
              />
            )}
            <Flex justify="between" align="center" gap="3" mt="3" wrap="wrap">
              <RowsPerPageSelect
                value={rowsPerPage}
                setValue={setRowsPerPage}
              />
              {visibleRows.length > rowsPerPage && (
                <Pagination
                  numItemsTotal={visibleRows.length}
                  currentPage={page}
                  perPage={rowsPerPage}
                  onPageChange={setPage}
                />
              )}
            </Flex>
          </>
        )}
      </CollapsibleSidePanel>
    </Frame>
  );
}
