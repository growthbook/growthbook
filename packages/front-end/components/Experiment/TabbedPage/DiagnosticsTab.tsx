import { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type {
  ExperimentDiagnosticsAggregatedSummary,
  ExperimentDiagnosticsRecord,
} from "shared/validators";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import Field from "@/components/Forms/Field";
import {
  FilterDropdown,
  useSearchFiltersBase,
} from "@/components/Search/SearchFilters";
import { transformQuery } from "@/services/search";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Sparkline from "@/components/EventLogs/Sparkline";
import Pagination from "@/ui/Pagination";

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\u2026";
}

type TimeRange = { label: string; hours: number };

const SUMMARY_RANGES: TimeRange[] = [
  { label: "Last 7 days", hours: 168 },
  { label: "Last 14 days", hours: 336 },
  { label: "Last 30 days", hours: 720 },
];

const RECORDS_RANGES: TimeRange[] = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 168 },
];

function buildDateRange(hours: number): {
  startDate: string;
  endDate: string;
} {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { startDate: from.toISOString(), endDate: now.toISOString() };
}

const datasourcesWithoutDiagnostics = new Set(["mixpanel", "google_analytics"]);

export interface DiagnosticsTabProps {
  experiment: ExperimentInterfaceStringDates;
}

export default function DiagnosticsTab({ experiment }: DiagnosticsTabProps) {
  const { getDatasourceById } = useDefinitions();
  const datasource = getDatasourceById(experiment.datasource);

  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (e) => e.id === experiment.exposureQueryId,
  );
  const dimensions = useMemo(
    () => exposureQuery?.dimensions ?? [],
    [exposureQuery?.dimensions],
  );

  const [summaryRange, setSummaryRange] = useState("168");
  const [summaryDimension, setSummaryDimension] = useState("__none__");
  const [recordsRange, setRecordsRange] = useState("24");
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsSearch, setRecordsSearch] = useState("");

  // Build filter keys dynamically: user, variation, plus all dimension names
  const filterKeys = useMemo(
    () => ["user", "variation", ...dimensions],
    [dimensions],
  );

  const parsedFilters = useMemo(() => {
    const { syntaxFilters, searchTerm } = transformQuery(
      recordsSearch,
      filterKeys,
    );
    const get = (field: string) =>
      syntaxFilters.find((f) => f.field === field)?.values[0] ?? "";

    const dimensionFilters: Record<string, string> = {};
    for (const dim of dimensions) {
      const val = get(dim);
      if (val) dimensionFilters[dim] = val;
    }

    return {
      syntaxFilters,
      userId: get("user") || searchTerm || "",
      variationId: get("variation"),
      dimensionFilters:
        Object.keys(dimensionFilters).length > 0 ? dimensionFilters : undefined,
    };
  }, [recordsSearch, filterKeys, dimensions]);
  const { syntaxFilters } = parsedFilters;

  const searchInputProps = useMemo(
    () => ({
      value: recordsSearch,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setRecordsSearch(e.target.value);
        setRecordsPage(1);
      },
    }),
    [recordsSearch],
  );

  const setSearchValue = useCallback((v: string) => {
    setRecordsSearch(v);
    setRecordsPage(1);
  }, []);

  const { dropdownFilterOpen, setDropdownFilterOpen, updateQuery } =
    useSearchFiltersBase({
      searchInputProps,
      syntaxFilters,
      setSearchValue,
    });

  // Variation filter items from experiment definition
  const variationItems = useMemo(
    () =>
      experiment.variations.map((v, i) => ({
        name: v.name || `Variation ${i}`,
        id: String(i),
        searchValue: String(i),
      })),
    [experiment.variations],
  );

  // Summary query
  const summaryQs = useMemo(() => {
    const { startDate, endDate } = buildDateRange(Number(summaryRange));
    const params = new URLSearchParams({ startDate, endDate });
    if (summaryDimension && summaryDimension !== "__none__")
      params.set("dimension", summaryDimension);
    return params.toString();
  }, [summaryRange, summaryDimension]);

  const canFetch =
    !!experiment.datasource &&
    !!experiment.exposureQueryId &&
    !!datasource &&
    !datasourcesWithoutDiagnostics.has(datasource.type);

  const {
    data: summaryData,
    error: summaryError,
    mutate: summaryMutate,
  } = useApi<{ summary: ExperimentDiagnosticsAggregatedSummary }>(
    `/experiment/${experiment.id}/diagnostics/summary?${summaryQs}`,
    { shouldRun: () => canFetch },
  );

  // Records query
  const recordsQs = useMemo(() => {
    const { startDate, endDate } = buildDateRange(Number(recordsRange));
    const params = new URLSearchParams({
      startDate,
      endDate,
      page: String(recordsPage),
    });
    if (parsedFilters.userId) params.set("userId", parsedFilters.userId);
    if (parsedFilters.variationId)
      params.set("variationId", parsedFilters.variationId);
    if (parsedFilters.dimensionFilters) {
      params.set(
        "dimensionFilters",
        JSON.stringify(parsedFilters.dimensionFilters),
      );
    }
    return params.toString();
  }, [recordsRange, recordsPage, parsedFilters]);

  const {
    data: recordsData,
    error: recordsError,
    mutate: recordsMutate,
  } = useApi<{ records: ExperimentDiagnosticsRecord[] }>(
    `/experiment/${experiment.id}/diagnostics/records?${recordsQs}`,
    { shouldRun: () => canFetch },
  );

  // Derive dimension filter options from loaded records
  const dimensionFilterOptions = useMemo(() => {
    const recs = recordsData?.records ?? [];
    const result: Record<
      string,
      { name: string; id: string; searchValue: string }[]
    > = {};
    for (const dim of dimensions) {
      const unique = [
        ...new Set(
          recs
            .map((r) => r.dimensions[dim])
            .filter((v): v is string => v !== null && v !== undefined),
        ),
      ].sort();
      if (unique.length > 0) {
        result[dim] = unique.map((v) => ({ name: v, id: v, searchValue: v }));
      }
    }
    return result;
  }, [recordsData, dimensions]);

  // Guard: no datasource
  if (!experiment.datasource || !datasource) {
    return (
      <Callout status="info">
        This experiment does not have a data source configured. Add a data
        source with an exposure assignment table to use diagnostics.
      </Callout>
    );
  }

  // Guard: unsupported datasource
  if (datasourcesWithoutDiagnostics.has(datasource.type)) {
    return (
      <Callout status="info">
        Diagnostics is not supported for {datasource.type} data sources.
      </Callout>
    );
  }

  // Guard: no exposure query
  if (!experiment.exposureQueryId || !exposureQuery) {
    return (
      <Callout status="info">
        This experiment does not have an exposure assignment table configured.
        Go to the Results tab and set one in Analysis Settings.
      </Callout>
    );
  }

  const summary = summaryData?.summary;
  const records = recordsData?.records ?? [];
  const PAGE_SIZE = 100;
  const recordsHasNext = records.length === PAGE_SIZE;

  const getVariationName = (variationId: string) => {
    const idx = parseInt(variationId, 10);
    if (!isNaN(idx) && idx >= 0 && idx < experiment.variations.length) {
      return experiment.variations[idx].name || `Variation ${idx}`;
    }
    return variationId;
  };

  return (
    <Box>
      {/* Summary section */}
      <Box mb="5">
        <Flex justify="between" align="center" mb="3">
          <Text size="lg" weight="semibold" color="text-high">
            Exposure summary
          </Text>
          <Flex gap="2" align="center">
            {dimensions.length > 0 && (
              <Select
                value={summaryDimension}
                setValue={(v) => setSummaryDimension(v)}
                size="md"
              >
                <SelectItem value="__none__">All (no dimension)</SelectItem>
                {dimensions.map((d) => (
                  <SelectItem key={d} value={d}>
                    By {d}
                  </SelectItem>
                ))}
              </Select>
            )}
            <Select
              value={summaryRange}
              setValue={(v) => setSummaryRange(v)}
              size="md"
            >
              {SUMMARY_RANGES.map((r) => (
                <SelectItem key={r.hours} value={String(r.hours)}>
                  {r.label}
                </SelectItem>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                summaryMutate();
                recordsMutate();
              }}
            >
              Update
            </Button>
          </Flex>
        </Flex>

        {summaryError && (
          <Callout status="warning">Failed to load exposure summary</Callout>
        )}

        {!summaryData && !summaryError && (
          <Text color="text-mid">Loading exposure summary...</Text>
        )}

        {summary && (
          <>
            {/* Stat cards */}
            <Flex gap="5" mb="4" wrap="wrap">
              <StatCard
                label="Total exposures"
                value={summary.totalExposures}
              />
              <StatCard label="Unique users" value={summary.totalUsers} />
              {summaryDimension === "__none__" &&
                summary.dailyTrend.length > 1 && (
                  <Box
                    style={{
                      padding: "16px 20px",
                      background: "var(--gray-a2)",
                      borderRadius: 8,
                      minWidth: 140,
                    }}
                  >
                    <Text size="sm" color="text-mid" as="div" mb="1">
                      Daily trend
                    </Text>
                    <Sparkline
                      data={summary.dailyTrend.map((d) => d.exposureCount)}
                    />
                  </Box>
                )}
            </Flex>

            {/* Per-variant breakdown — always shown */}
            {summary.variationBreakdown.length > 0 && (
              <Box mb="4">
                <Text
                  size="md"
                  weight="medium"
                  color="text-high"
                  as="div"
                  mb="2"
                >
                  Exposures per variation
                </Text>
                <Table variant="list" stickyHeader roundedCorners>
                  <TableHeader>
                    <TableRow>
                      <TableColumnHeader>Variation</TableColumnHeader>
                      <TableColumnHeader>Exposures</TableColumnHeader>
                      <TableColumnHeader>Unique users</TableColumnHeader>
                      <TableColumnHeader>Split</TableColumnHeader>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.variationBreakdown.map((v) => (
                      <TableRow key={v.variationId}>
                        <TableCell>
                          <Text weight="medium">
                            {getVariationName(v.variationId)}
                          </Text>
                        </TableCell>
                        <TableCell>{formatCount(v.exposureCount)}</TableCell>
                        <TableCell>{formatCount(v.userCount)}</TableCell>
                        <TableCell>
                          {summary.totalExposures > 0
                            ? (
                                (v.exposureCount / summary.totalExposures) *
                                100
                              ).toFixed(1) + "%"
                            : "0%"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            {/* Dimension breakdown — shown when dimension is selected */}
            {summaryDimension !== "__none__" &&
              summary.dimensionBreakdown &&
              summary.dimensionBreakdown.length > 0 && (
                <Box mb="4">
                  <Text
                    size="md"
                    weight="medium"
                    color="text-high"
                    as="div"
                    mb="2"
                  >
                    Exposures by {summaryDimension}
                  </Text>
                  <Table variant="list" stickyHeader roundedCorners>
                    <TableHeader>
                      <TableRow>
                        <TableColumnHeader>
                          {summaryDimension}
                        </TableColumnHeader>
                        <TableColumnHeader>Exposures</TableColumnHeader>
                        <TableColumnHeader>Unique users</TableColumnHeader>
                        <TableColumnHeader>Split</TableColumnHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.dimensionBreakdown.map((d) => (
                        <TableRow key={d.dimensionValue}>
                          <TableCell>
                            <Text weight="medium">
                              {d.dimensionValue || "(empty)"}
                            </Text>
                          </TableCell>
                          <TableCell>{formatCount(d.exposureCount)}</TableCell>
                          <TableCell>{formatCount(d.userCount)}</TableCell>
                          <TableCell>
                            {summary.totalExposures > 0
                              ? (
                                  (d.exposureCount / summary.totalExposures) *
                                  100
                                ).toFixed(1) + "%"
                              : "0%"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

            {/* Variant x Dimension breakdown */}
            {summaryDimension !== "__none__" &&
              summary.variationDimensionBreakdown &&
              summary.variationDimensionBreakdown.length > 0 && (
                <Box mb="4">
                  <Text
                    size="md"
                    weight="medium"
                    color="text-high"
                    as="div"
                    mb="2"
                  >
                    Exposures per variation by {summaryDimension}
                  </Text>
                  <Table variant="list" stickyHeader roundedCorners>
                    <TableHeader>
                      <TableRow>
                        <TableColumnHeader>Variation</TableColumnHeader>
                        <TableColumnHeader>
                          {summaryDimension}
                        </TableColumnHeader>
                        <TableColumnHeader>Exposures</TableColumnHeader>
                        <TableColumnHeader>Unique users</TableColumnHeader>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.variationDimensionBreakdown.map((row, i) => (
                        <TableRow
                          key={`${row.variationId}-${row.dimensionValue}-${i}`}
                        >
                          <TableCell>
                            <Text weight="medium">
                              {getVariationName(row.variationId)}
                            </Text>
                          </TableCell>
                          <TableCell>
                            {row.dimensionValue || "(empty)"}
                          </TableCell>
                          <TableCell>
                            {formatCount(row.exposureCount)}
                          </TableCell>
                          <TableCell>{formatCount(row.userCount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
          </>
        )}
      </Box>

      {/* Records section */}
      <Box>
        <Flex justify="between" align="center" mb="3">
          <Text size="lg" weight="semibold" color="text-high">
            Exposure records
          </Text>
          <Select
            value={recordsRange}
            setValue={(v) => {
              setRecordsRange(v);
              setRecordsPage(1);
            }}
            size="md"
          >
            {RECORDS_RANGES.map((r) => (
              <SelectItem key={r.hours} value={String(r.hours)}>
                {r.label}
              </SelectItem>
            ))}
          </Select>
        </Flex>

        <Flex gap="4" align="center" justify="between" mb="4" wrap="wrap">
          <Box flexBasis="300px" flexShrink="0">
            <Field
              size="sm"
              placeholder={`Search... (user:id variation:0${dimensions.length > 0 ? ` ${dimensions[0]}:value` : ""})`}
              type="search"
              containerClassName="mb-0"
              {...searchInputProps}
            />
          </Box>
          <Flex gap="2" align="center" wrap="wrap">
            <FilterDropdown
              filter="variation"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={variationItems}
              updateQuery={updateQuery}
            />
            {dimensions.map(
              (dim) =>
                dimensionFilterOptions[dim] &&
                dimensionFilterOptions[dim].length > 0 && (
                  <FilterDropdown
                    key={dim}
                    filter={dim}
                    syntaxFilters={syntaxFilters}
                    open={dropdownFilterOpen}
                    setOpen={setDropdownFilterOpen}
                    items={dimensionFilterOptions[dim]}
                    updateQuery={updateQuery}
                  />
                ),
            )}
            {recordsSearch && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchValue("")}
              >
                Clear
              </Button>
            )}
          </Flex>
        </Flex>

        {recordsError && (
          <Callout status="warning">Failed to load exposure records</Callout>
        )}

        {!recordsData && !recordsError && (
          <Text color="text-mid">Loading exposure records...</Text>
        )}

        {recordsData && records.length === 0 && (
          <Text color="text-mid">
            No exposure records found for the selected filters and time range.
          </Text>
        )}

        {recordsData && records.length > 0 && (
          <>
            <Table variant="list" stickyHeader roundedCorners>
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Timestamp</TableColumnHeader>
                  <TableColumnHeader>User ID</TableColumnHeader>
                  <TableColumnHeader>Variation</TableColumnHeader>
                  {dimensions.map((d) => (
                    <TableColumnHeader key={d}>{d}</TableColumnHeader>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record, i) => (
                  <TableRow key={`${record.timestamp}-${i}`}>
                    <TableCell>
                      <span style={{ fontSize: 12, fontFamily: "monospace" }}>
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        style={{ fontSize: 12, fontFamily: "monospace" }}
                        title={record.userId ?? ""}
                      >
                        {truncate(record.userId ?? "", 24)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        label={getVariationName(record.variationId)}
                        size="xs"
                        variant="soft"
                        radius="full"
                      />
                    </TableCell>
                    {dimensions.map((d) => (
                      <TableCell key={d}>
                        <span style={{ fontSize: 12 }}>
                          {record.dimensions[d] ?? ""}
                        </span>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {(recordsPage > 1 || recordsHasNext) && (
              <Pagination
                numItemsTotal={
                  recordsHasNext
                    ? (recordsPage + 1) * PAGE_SIZE
                    : (recordsPage - 1) * PAGE_SIZE + records.length
                }
                currentPage={recordsPage}
                perPage={PAGE_SIZE}
                onPageChange={setRecordsPage}
              />
            )}
          </>
        )}
      </Box>
    </Box>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Box
      style={{
        padding: "16px 20px",
        background: "var(--gray-a2)",
        borderRadius: 8,
        minWidth: 140,
      }}
    >
      <Text size="sm" color="text-mid" as="div" mb="1">
        {label}
      </Text>
      <Text size="lg" weight="semibold" color="text-high">
        {formatCount(value)}
      </Text>
    </Box>
  );
}
