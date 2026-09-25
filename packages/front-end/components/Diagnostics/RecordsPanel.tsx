import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowsClockwise } from "react-icons/pi";
import { ago, datetime } from "shared/dates";
import LoadingSpinner from "@/components/LoadingSpinner";
import Field from "@/components/Forms/Field";
import { FilterDropdown } from "@/components/Search/SearchFilters";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Pagination from "@/ui/Pagination";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { Select, SelectItem } from "@/ui/Select";
import ExpandableTable from "./ExpandableTable";
import { RecordsColumn, RecordsFilterOption } from "./types";
import { UseRecordsQueryResult } from "./useRecordsQuery";

export interface RecordsPanelProps<TRow extends object, TResponse> {
  title: string;
  query: UseRecordsQueryResult<TRow, TResponse>;

  columns: RecordsColumn<TRow>[];
  getRowId: (row: TRow, index: number) => string;
  renderDetail?: (row: TRow) => ReactNode;
  detailFlattenKeys?: string[];
  detailTitle?: string;

  hasNextPage: boolean;
  searchPlaceholder?: string;
  /** Keyed by filter key; an empty list renders no dropdown for that key. */
  filterOptions?: Record<string, RecordsFilterOption[]>;
  filterOrder?: string[];

  /** When the displayed results were produced. */
  lastUpdated?: string | Date | null;

  emptyMessage?: string;
  /**
   * Rendered above the table as-is, e.g. a warehouse error returned in a 200.
   * Callers own the presentation so they can supply their own Callout.
   */
  warning?: ReactNode;
  headerActions?: ReactNode;
  containerClassName?: string;
}

export default function RecordsPanel<TRow extends object, TResponse>({
  title,
  query,
  columns,
  getRowId,
  renderDetail,
  detailFlattenKeys,
  detailTitle,
  hasNextPage,
  searchPlaceholder,
  filterOptions = {},
  filterOrder,
  lastUpdated,
  emptyMessage = "No records found for this time range.",
  warning,
  headerActions,
  containerClassName = "box p-3 my-4",
}: RecordsPanelProps<TRow, TResponse>) {
  const {
    rows,
    error,
    isLoading,
    isRefreshing,
    hasRun,
    autoRun,
    refresh,
    rangeHours,
    setRangeHours,
    timeRanges,
    page,
    setPage,
    pageSize,
    search,
  } = query;

  const dropdownKeys = (filterOrder ?? Object.keys(filterOptions)).filter(
    (key) => (filterOptions[key] ?? []).length > 0,
  );

  return (
    <div className={containerClassName}>
      <Flex justify="between" align="center" gap="3" mb="3" wrap="wrap">
        <h3 className="mb-0">{title}</h3>
        <Flex gap="2" align="center" wrap="wrap">
          {headerActions}
          {lastUpdated && (
            <Tooltip body={datetime(lastUpdated)}>
              <Text size="sm" color="text-low">
                Last updated {ago(lastUpdated)}
              </Text>
            </Tooltip>
          )}
          <Select
            value={String(rangeHours)}
            setValue={(v) => setRangeHours(Number(v))}
            size="sm"
          >
            {timeRanges.map((r) => (
              <SelectItem key={r.hours} value={String(r.hours)}>
                {r.label}
              </SelectItem>
            ))}
          </Select>
          <Button
            variant="outline"
            loading={isRefreshing}
            onClick={refresh}
            icon={<PiArrowsClockwise />}
          >
            Update
          </Button>
        </Flex>
      </Flex>

      <Flex gap="2" align="center" mb="3" wrap="wrap">
        <Box flexGrow="1" mr="2" style={{ minWidth: 240 }}>
          <Field
            type="search"
            containerClassName="mb-0"
            placeholder={searchPlaceholder}
            {...search.searchInputProps}
          />
        </Box>
        {dropdownKeys.map((key) => (
          <FilterDropdown
            key={key}
            filter={key}
            syntaxFilters={search.syntaxFilters}
            open={search.dropdownFilterOpen}
            setOpen={search.setDropdownFilterOpen}
            items={filterOptions[key]}
            updateQuery={search.updateQuery}
          />
        ))}
        {search.searchInputProps.value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => search.setSearchValue("")}
          >
            Clear
          </Button>
        )}
      </Flex>

      {warning && <Box mb="3">{warning}</Box>}
      {error && (
        <Callout status="error" size="sm" mb="3">
          {error.message}
        </Callout>
      )}

      {!hasRun && !autoRun && !isRefreshing ? (
        <Text size="sm" color="text-low">
          Click Update to load exposure records.
        </Text>
      ) : isLoading ? (
        <LoadingSpinner />
      ) : rows.length === 0 && !error ? (
        <Text size="sm" color="text-low">
          {emptyMessage}
        </Text>
      ) : rows.length > 0 ? (
        <>
          <ExpandableTable
            rows={rows}
            columns={columns}
            getRowId={getRowId}
            renderDetail={renderDetail}
            detailFlattenKeys={detailFlattenKeys}
            detailTitle={detailTitle}
          />
          {(page > 1 || hasNextPage) && (
            <Pagination
              numItemsTotal={
                hasNextPage
                  ? (page + 1) * pageSize
                  : (page - 1) * pageSize + rows.length
              }
              currentPage={page}
              perPage={pageSize}
              onPageChange={setPage}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
