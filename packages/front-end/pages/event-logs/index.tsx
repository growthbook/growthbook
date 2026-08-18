import React, { useCallback, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { useGrowthBook } from "@growthbook/growthbook-react";
import type { AppFeatures } from "shared/types/app-features";
import type { EventLogSummaryItem, EventLogRecord } from "shared/validators";
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
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Sparkline from "@/components/EventLogs/Sparkline";
import Custom404 from "@/pages/404";

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
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 3 days", hours: 72 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 14 days", hours: 336 },
];

const RECORDS_RANGES: TimeRange[] = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 12 hours", hours: 12 },
  { label: "Last 24 hours", hours: 24 },
];

function buildDateRange(hours: number): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { dateFrom: from.toISOString(), dateTo: now.toISOString() };
}

const RECORDS_FILTER_KEYS = [
  "event",
  "user",
  "env",
  "browser",
  "os",
  "country",
  "sdk",
];

export default function EventLogsPage() {
  const gb = useGrowthBook<AppFeatures>();
  const { hasCommercialFeature } = useUser();
  const { project } = useDefinitions();
  const environments = useEnvironments();

  const [summaryRange, setSummaryRange] = useState("168");
  const [summaryPage, setSummaryPage] = useState(1);
  const [summarySearch, setSummarySearch] = useState("");

  const [recordsRange, setRecordsRange] = useState("1");
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsSearch, setRecordsSearch] = useState("env:production");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const eventLogsEnabled = !!gb?.isOn("event-logs");
  const hasFeature = hasCommercialFeature("event-logs");

  // Parse the records search string into structured filters + free text
  const parsedFilters = useMemo(() => {
    const { syntaxFilters, searchTerm } = transformQuery(
      recordsSearch,
      RECORDS_FILTER_KEYS,
    );
    const get = (field: string) =>
      syntaxFilters.find((f) => f.field === field)?.values[0] ?? "";
    return {
      syntaxFilters,
      eventName: get("event") || searchTerm || "",
      userId: get("user"),
      environment: get("env"),
      browser: get("browser"),
      os: get("os"),
      country: get("country"),
      sdk: get("sdk"),
    };
  }, [recordsSearch]);
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

  // Summary query
  const summaryQs = useMemo(() => {
    const { dateFrom, dateTo } = buildDateRange(Number(summaryRange));
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      page: String(summaryPage),
    });
    if (summarySearch) params.set("search", summarySearch);
    if (project) params.set("project", project);
    return params.toString();
  }, [summaryRange, summaryPage, summarySearch, project]);

  const canFetch = hasFeature && eventLogsEnabled;
  const { data: summaryData, error: summaryError } = useApi<{
    items: EventLogSummaryItem[];
  }>(`/event-logs/summary?${summaryQs}`, {
    shouldRun: () => canFetch,
  });

  // Records query
  const recordsQs = useMemo(() => {
    const { dateFrom, dateTo } = buildDateRange(Number(recordsRange));
    const params = new URLSearchParams({
      dateFrom,
      dateTo,
      page: String(recordsPage),
    });
    if (parsedFilters.eventName)
      params.set("eventName", parsedFilters.eventName);
    if (parsedFilters.userId) params.set("userId", parsedFilters.userId);
    if (parsedFilters.environment)
      params.set("environment", parsedFilters.environment);
    if (parsedFilters.browser) params.set("browser", parsedFilters.browser);
    if (parsedFilters.os) params.set("os", parsedFilters.os);
    if (parsedFilters.country) params.set("country", parsedFilters.country);
    if (parsedFilters.sdk) params.set("sdk", parsedFilters.sdk);
    if (project) params.set("project", project);
    return params.toString();
  }, [recordsRange, recordsPage, parsedFilters, project]);

  const { data: recordsData, error: recordsError } = useApi<{
    records: EventLogRecord[];
  }>(`/event-logs/records?${recordsQs}`, {
    shouldRun: () => canFetch,
  });

  // Derive dropdown options from loaded records
  const recordFilterOptions = useMemo(() => {
    const records = recordsData?.records ?? [];
    const unique = (fn: (r: EventLogRecord) => string | null) =>
      [...new Set(records.map(fn).filter(Boolean))].sort().map((v) => ({
        name: v as string,
        id: v as string,
        searchValue: v as string,
      }));
    return {
      browsers: unique((r) => r.uaBrowser),
      oses: unique((r) => r.uaOs),
      countries: unique((r) => r.geoCountry),
      sdks: unique((r) => r.sdkLanguage),
    };
  }, [recordsData]);

  if (!eventLogsEnabled) {
    return <Custom404 />;
  }

  if (!hasFeature) {
    return (
      <div className="container pagecontents">
        <h1>Event Logs</h1>
        <Callout status="info">
          Event logs requires a Pro or Enterprise plan. Upgrade to inspect raw
          SDK events in-app.
        </Callout>
      </div>
    );
  }

  const summaryItems = summaryData?.items ?? [];
  const records = recordsData?.records ?? [];
  const summaryHasNext = summaryItems.length === 100;
  const recordsHasNext = records.length === 100;

  return (
    <div className="container pagecontents">
      <h1>Event Logs</h1>

      {/* ---- Summary section ---- */}
      <Box mb="5">
        <Flex justify="between" align="center" mb="3">
          <Text size="lg" weight="semibold" color="text-high">
            Event summary
          </Text>
          <Flex gap="2" align="center">
            <Box style={{ width: 220 }}>
              <Field
                size="sm"
                placeholder="Search event names..."
                type="search"
                containerClassName="mb-0"
                value={summarySearch}
                onChange={(e) => {
                  setSummarySearch(e.target.value);
                  setSummaryPage(1);
                }}
              />
            </Box>
            <Select
              value={summaryRange}
              setValue={(v) => {
                setSummaryRange(v);
                setSummaryPage(1);
              }}
              size="md"
            >
              {SUMMARY_RANGES.map((r) => (
                <SelectItem key={r.hours} value={String(r.hours)}>
                  {r.label}
                </SelectItem>
              ))}
            </Select>
          </Flex>
        </Flex>

        {summaryError && (
          <Callout status="warning">Failed to load event summary</Callout>
        )}

        {!summaryData && !summaryError && (
          <Text color="text-mid">Loading event summary...</Text>
        )}

        {summaryData && summaryItems.length === 0 && (
          <Text color="text-mid">
            No events found for the selected time range.
          </Text>
        )}

        {summaryData && summaryItems.length > 0 && (
          <>
            <Table variant="list" size="md">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Event name</TableColumnHeader>
                  <TableColumnHeader>Trend</TableColumnHeader>
                  <TableColumnHeader>Total count</TableColumnHeader>
                  <TableColumnHeader>Avg. daily users</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryItems.map((item) => (
                  <TableRow
                    key={item.eventName}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      const name = item.eventName.includes(" ")
                        ? `"${item.eventName}"`
                        : item.eventName;
                      const envPart = parsedFilters.environment
                        ? ` env:${parsedFilters.environment}`
                        : "";
                      setSearchValue(`event:${name}${envPart}`);
                    }}
                  >
                    <TableCell>
                      <Text weight="medium" color="text-high">
                        {item.eventName}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Sparkline data={item.dailyCounts} />
                    </TableCell>
                    <TableCell>{formatCount(item.totalCount)}</TableCell>
                    <TableCell>{formatCount(item.dauCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Flex justify="between" align="center" mt="3">
              <Text color="text-low" size="sm">
                Showing {summaryItems.length} event
                {summaryItems.length === 1 ? "" : "s"}
              </Text>
              <Flex gap="1">
                <Button
                  variant="outline"
                  disabled={summaryPage <= 1}
                  onClick={() => setSummaryPage(summaryPage - 1)}
                >
                  Previous
                </Button>
                <Button variant="ghost">{summaryPage}</Button>
                <Button
                  variant="outline"
                  disabled={!summaryHasNext}
                  onClick={() => setSummaryPage(summaryPage + 1)}
                >
                  Next
                </Button>
              </Flex>
            </Flex>
          </>
        )}
      </Box>

      {/* ---- Log stream section ---- */}
      <Box>
        <Flex justify="between" align="center" mb="3">
          <Text size="lg" weight="semibold" color="text-high">
            Event log stream
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

        <Flex gap="2" align="center" mb="3">
          <Box flexGrow="1">
            <Field
              size="sm"
              placeholder="Search... (event:name user:id env:production)"
              type="search"
              containerClassName="mb-0"
              {...searchInputProps}
            />
          </Box>
          <FilterDropdown
            filter="env"
            heading="environment"
            syntaxFilters={syntaxFilters}
            open={dropdownFilterOpen}
            setOpen={setDropdownFilterOpen}
            items={environments.map((e) => ({
              name: e.id,
              id: e.id,
              searchValue: e.id,
            }))}
            updateQuery={updateQuery}
          />
          {recordFilterOptions.browsers.length > 0 && (
            <FilterDropdown
              filter="browser"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={recordFilterOptions.browsers}
              updateQuery={updateQuery}
            />
          )}
          {recordFilterOptions.oses.length > 0 && (
            <FilterDropdown
              filter="os"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={recordFilterOptions.oses}
              updateQuery={updateQuery}
            />
          )}
          {recordFilterOptions.countries.length > 0 && (
            <FilterDropdown
              filter="country"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={recordFilterOptions.countries}
              updateQuery={updateQuery}
            />
          )}
          {recordFilterOptions.sdks.length > 0 && (
            <FilterDropdown
              filter="sdk"
              syntaxFilters={syntaxFilters}
              open={dropdownFilterOpen}
              setOpen={setDropdownFilterOpen}
              items={recordFilterOptions.sdks}
              updateQuery={updateQuery}
            />
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

        {recordsError && (
          <Callout status="warning">Failed to load event records</Callout>
        )}

        {!recordsData && !recordsError && (
          <Text color="text-mid">Loading event records...</Text>
        )}

        {recordsData && records.length === 0 && (
          <Text color="text-mid">
            No events found for the selected filters and time range.
          </Text>
        )}

        {recordsData && records.length > 0 && (
          <>
            <Table variant="list" size="md">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Timestamp</TableColumnHeader>
                  <TableColumnHeader>Event</TableColumnHeader>
                  <TableColumnHeader>User ID</TableColumnHeader>
                  <TableColumnHeader>Environment</TableColumnHeader>
                  <TableColumnHeader>Properties</TableColumnHeader>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => {
                  const isExpanded = expandedRow === record.eventUuid;
                  const propsStr = JSON.stringify(record.properties);
                  return (
                    <React.Fragment key={record.eventUuid}>
                      <TableRow
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          setExpandedRow(isExpanded ? null : record.eventUuid)
                        }
                      >
                        <TableCell>
                          <span
                            style={{ fontSize: 12, fontFamily: "monospace" }}
                          >
                            {formatTimestamp(record.timestamp)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Text weight="medium">{record.eventName}</Text>
                        </TableCell>
                        <TableCell>
                          <span
                            style={{ fontSize: 12, fontFamily: "monospace" }}
                            title={record.userId ?? ""}
                          >
                            {truncate(record.userId ?? "", 20)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {record.environment && (
                            <Badge
                              label={record.environment}
                              size="xs"
                              variant="soft"
                              color={
                                record.environment === "production"
                                  ? "green"
                                  : "gray"
                              }
                              radius="full"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            style={{
                              fontSize: 12,
                              fontFamily: "monospace",
                              color: "var(--color-text-low)",
                            }}
                          >
                            {truncate(propsStr, 80)}
                          </span>
                        </TableCell>
                      </TableRow>

                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={5}>
                            <EventRecordDetail record={record} />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>

            <Flex justify="between" align="center" mt="3">
              <Text color="text-low" size="sm">
                Showing {records.length} record
                {records.length === 1 ? "" : "s"}
              </Text>
              <Flex gap="1">
                <Button
                  variant="outline"
                  disabled={recordsPage <= 1}
                  onClick={() => setRecordsPage(recordsPage - 1)}
                >
                  Previous
                </Button>
                <Button variant="ghost">{recordsPage}</Button>
                <Button
                  variant="outline"
                  disabled={!recordsHasNext}
                  onClick={() => setRecordsPage(recordsPage + 1)}
                >
                  Next
                </Button>
              </Flex>
            </Flex>
          </>
        )}
      </Box>
    </div>
  );
}

function EventRecordDetail({ record }: { record: EventLogRecord }) {
  return (
    <Box
      style={{
        padding: "12px 16px",
        background: "var(--gray-a2)",
        borderRadius: 6,
      }}
    >
      <Flex gap="5" wrap="wrap">
        <DetailSection title="Properties">
          <pre style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(record.properties, null, 2)}
          </pre>
        </DetailSection>
        <DetailSection title="User attributes">
          <pre style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(record.attributes, null, 2)}
          </pre>
        </DetailSection>
        <DetailSection title="Details">
          <DetailRow label="URL" value={record.url} />
          <DetailRow label="Country" value={record.geoCountry} />
          <DetailRow label="Browser" value={record.uaBrowser} />
          <DetailRow label="OS" value={record.uaOs} />
          <DetailRow label="Device type" value={record.uaDeviceType} />
          <DetailRow label="SDK" value={record.sdkLanguage} />
          <DetailRow label="SDK version" value={record.sdkVersion} />
          <DetailRow label="Device ID" value={record.deviceId} />
        </DetailSection>
      </Flex>
    </Box>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box style={{ minWidth: 200, flex: 1 }}>
      <Text size="sm" weight="semibold" color="text-high" as="div" mb="1">
        {title}
      </Text>
      {children}
    </Box>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <Flex gap="2" mb="1">
      <span
        style={{ fontSize: 12, color: "var(--color-text-mid)", minWidth: 80 }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, fontFamily: "monospace" }}>{value}</span>
    </Flex>
  );
}
