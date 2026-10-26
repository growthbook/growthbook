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
import { rowsWithinWindow } from "./recordsWindow";
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
  timestampColumn?: string;
  /** Columns and their values, for the filter panel's pickers. */
  columnSource: FilterColumnSource;

  renderDetail?: (row: TRow) => ReactNode;
  detailFlattenKeys?: string[];
  detailTitle?: string;

  searchPlaceholder?: string;

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
  timestampColumn = "timestamp",
  columnSource,
  renderDetail,
  detailFlattenKeys,
  detailTitle,
  searchPlaceholder = "Search...",
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
    isIdle,
    localNarrowingIsLossy,
    truncated,
    ranAt,
    submit,
    hasPendingChanges,
    dateRange,
    rowFilters,
    applyControls,
    appliedRowFilters,
    visibleWindow,
  } = query;

  const [search, setSearch] = useState("");
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [page, setPage] = useState(1);

  // Compared against the filters the loaded rows were fetched with, not the
  // ones a request was sent with: during an in-flight refresh, and after a
  // failed one, the rows on screen are still the old ones.
  const filtersAreServerApplied = isEqual(rowFilters, appliedRowFilters);

  // Set only when Apply shortened the timeframe without re-querying, so the
  // buffer covers more than the controls now ask for.
  const windowedRows = useMemo(
    () =>
      visibleWindow
        ? rowsWithinWindow(rows, visibleWindow, (row) =>
            getFilterValue(row, timestampColumn),
          )
        : rows,
    [rows, visibleWindow, getFilterValue, timestampColumn],
  );

  const filteredRows = useMemo(
    () =>
      filtersAreServerApplied
        ? windowedRows
        : applyRowFilters(windowedRows, rowFilters, getFilterValue),
    [windowedRows, rowFilters, filtersAreServerApplied, getFilterValue],
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return filteredRows;
    return filteredRows.filter((row) =>
      getSearchText(row).toLowerCase().includes(term),
    );
  }, [filteredRows, search, getSearchText]);

  // Narrowing the results can leave the current page past the end.
  useEffect(() => setPage(1), [visibleRows.length, rowsPerPage]);

  const pageRows = useMemo(
    () => visibleRows.slice((page - 1) * rowsPerPage, page * rowsPerPage),
    [visibleRows, page, rowsPerPage],
  );

  const filterPanel = (
    <Flex direction="column" gap="4" height="100%">
      <Flex direction="column" gap="2">
        <Text weight="medium">Timeframe</Text>
        <DateRangeCompareDropdown
          value={{ dateRange, comparison: null }}
          onChange={(next) => applyControls({ dateRange: next.dateRange })}
          disabled={isRefreshing}
          fullWidth
        />
      </Flex>
      <RowFilterPanel
        value={rowFilters}
        setValue={(filters) => applyControls({ rowFilters: filters })}
        columnSource={columnSource}
        disabled={isRefreshing}
        listMaxHeight={tableMaxHeight}
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
          {ranAt && (
            <Tooltip content={datetime(ranAt)}>
              <Text size="sm" color="text-low">
                {`Updated ${ago(ranAt).replace("about ", "")}`}
              </Text>
            </Tooltip>
          )}
          <Button
            variant={hasPendingChanges ? "solid" : "soft"}
            size="sm"
            loading={isRefreshing}
            disabled={isRefreshing}
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
            Row limit exceeded. Data below only contains the most recent
            exposures. Use a narrower timeframe or add a filter to ensure all
            relevant exposures are included.
            {search.trim() ? " Search looks at the loaded rows alone." : ""}
          </Callout>
        )}

        {localNarrowingIsLossy && (
          <Callout status="warning" size="sm" mb="3">
            These rows were loaded with different filters. Refresh to apply the
            current ones.
          </Callout>
        )}

        {isIdle ? (
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
