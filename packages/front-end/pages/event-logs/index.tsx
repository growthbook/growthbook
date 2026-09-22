import React, { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretLeft, PiCaretRight } from "react-icons/pi";
import { useGrowthBook } from "@growthbook/growthbook-react";
import type { AppFeatures } from "shared/types/app-features";
import type { EventLogSummaryItem } from "shared/validators";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Badge from "@/ui/Badge";
import Pagination from "@/ui/Pagination";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Sparkline from "@/components/EventLogs/Sparkline";
import EventSummaryFilterBar from "@/components/EventLogs/EventSummaryFilterBar";
import StreamSearchField from "@/components/Diagnostics/StreamSearchField";
import summaryTableStyles from "@/components/EventLogs/EventSummaryTable.module.scss";
import {
  isStale,
  matchesArrivalStatus,
  type ArrivalStatus,
} from "@/components/EventLogs/staleness";
import type { UsedByFilter } from "@/components/EventLogs/EventSummaryFilterBar";
import EventLogStream from "@/components/EventLogs/EventLogStream";
import {
  TimeRange,
  buildDateRange,
  formatTimestamp,
} from "@/components/EventLogs/eventLogUtils";
import Custom404 from "@/pages/404";

function formatCount(n: number): string {
  return new Intl.NumberFormat().format(n);
}

const SUMMARY_RANGES: TimeRange[] = [
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 3 days", hours: 72 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 14 days", hours: 336 },
];

const SUMMARY_ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50];
const SUMMARY_DEFAULT_ROWS_PER_PAGE = 5;
export default function EventLogsPage() {
  const gb = useGrowthBook<AppFeatures>();
  const { hasCommercialFeature } = useUser();
  const { project, datasources } = useDefinitions();
  const environments = useEnvironments();

  // Events are only ever read from the org's managed warehouse, so this names
  // the scope rather than offering a choice. Falls back to the product's own
  // term when the datasource is not readable (or not provisioned locally).
  const managedWarehouseName =
    datasources.find((d) => d.type === "growthbook_clickhouse")?.name ??
    "Managed Warehouse";

  const [summaryRange, setSummaryRange] = useState("168");
  const [summaryPage, setSummaryPage] = useState(1);
  const [summaryRowsPerPage, setSummaryRowsPerPage] = useState(
    SUMMARY_DEFAULT_ROWS_PER_PAGE,
  );
  const [summarySearch, setSummarySearch] = useState("");
  const [summaryEnvironment, setSummaryEnvironment] = useState<string | null>(
    null,
  );
  // Overrides the global project selector while set; null falls back to it.
  const [summaryProject, setSummaryProject] = useState<string | null>(null);
  // "<identifier>:covered" | "<identifier>:empty"
  const [summaryIdentifierType, setSummaryIdentifierType] = useState<
    string | null
  >(null);
  const [summaryUsedBy, setSummaryUsedBy] = useState<UsedByFilter | null>(null);
  const [summaryArrivalStatus, setSummaryArrivalStatus] =
    useState<ArrivalStatus | null>(null);

  // Owned here, not by the stream, so clicking a Summary row can filter it —
  // the same interaction that existed before the stream was extracted.
  const [streamSearch, setStreamSearch] = useState("");

  const eventLogsEnabled = !!gb?.isOn("event-logs");
  const hasFeature = hasCommercialFeature("event-logs");

  // Summary query
  const summaryQs = useMemo(() => {
    const { dateFrom, dateTo } = buildDateRange(Number(summaryRange));
    // The endpoint pages at a fixed 100; rows-per-page is applied client-side
    // below, so the page number is not part of the request.
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (summarySearch) params.set("search", summarySearch);
    if (summaryEnvironment) params.set("environment", summaryEnvironment);
    const effectiveProject = summaryProject ?? project;
    if (effectiveProject) params.set("project", effectiveProject);
    return params.toString();
  }, [
    summaryRange,
    summarySearch,
    summaryEnvironment,
    summaryProject,
    project,
  ]);

  const canFetch = hasFeature && eventLogsEnabled;
  const { data: summaryData, error: summaryError } = useApi<{
    items: EventLogSummaryItem[];
  }>(`/event-logs/summary?${summaryQs}`, {
    shouldRun: () => canFetch,
  });

  if (!eventLogsEnabled) {
    return <Custom404 />;
  }

  if (!hasFeature) {
    return (
      <div className="container pagecontents">
        <h1>Events</h1>
        <Callout status="info">
          Event logs requires a Pro or Enterprise plan. Upgrade to inspect raw
          SDK events in-app.
        </Callout>
      </div>
    );
  }

  const allSummaryItems = summaryData?.items ?? [];

  // Identifier coverage, used-by and arrival status are applied here rather than
  // in the query: all three are derivable from fields already on the response,
  // so filtering client-side avoids a refetch per pill change.
  const summaryItems = allSummaryItems.filter((item) => {
    if (summaryIdentifierType) {
      const [identifier, mode] = summaryIdentifierType.split(":");
      const coverage = item.identifierCoverage?.find(
        (c) => c.identifier === identifier,
      );
      const nonNull = coverage?.nonNullCount ?? 0;
      if (mode === "covered" ? nonNull === 0 : nonNull > 0) return false;
    }

    if (summaryUsedBy) {
      const used = item.usedBy ?? { factTableIds: [], metricIds: [] };
      if (summaryUsedBy === "metric" && used.metricIds.length === 0) {
        return false;
      }
      if (summaryUsedBy === "factTable" && used.factTableIds.length === 0) {
        return false;
      }
      if (
        summaryUsedBy === "nothing" &&
        (used.metricIds.length > 0 || used.factTableIds.length > 0)
      ) {
        return false;
      }
    }

    if (summaryArrivalStatus) {
      const { dateFrom } = buildDateRange(Number(summaryRange));
      if (
        !matchesArrivalStatus(item, summaryArrivalStatus, new Date(dateFrom))
      ) {
        return false;
      }
    }

    return true;
  });
  // Rows-per-page is applied client-side over the fetched set.
  const summaryPageCount = Math.max(
    1,
    Math.ceil(summaryItems.length / summaryRowsPerPage),
  );
  // Guards against a stale page after the row count shrinks (new search, or a
  // larger rows-per-page), which would otherwise render an empty table.
  const summaryCurrentPage = Math.min(summaryPage, summaryPageCount);
  const summaryVisibleItems = summaryItems.slice(
    (summaryCurrentPage - 1) * summaryRowsPerPage,
    summaryCurrentPage * summaryRowsPerPage,
  );

  return (
    <div className="container pagecontents">
      <h1>Events</h1>

      {/* ---- Summary section ---- */}
      {/* pt on a wrapper rather than mt on the card: an adjacent-sibling margin
          would collapse with the h1's bottom margin instead of adding to it. */}
      <Box pt="3">
        {/* px/py rather than p: Frame hard-codes py="5" px="6", and a bare p
            would not reliably win over them in the Radix class order. */}
        <Frame mb="5" px="5" py="5">
          <Heading as="h2" size="md" mb="3">
            Summary
          </Heading>
          <Box mb="3">
            <EventSummaryFilterBar
              dataSourceName={managedWarehouseName}
              leading={
                <Box flexBasis="440px" flexShrink="0">
                  <StreamSearchField
                    placeholder="Search event names..."
                    value={summarySearch}
                    onChange={(v) => {
                      setSummarySearch(v);
                      setSummaryPage(1);
                    }}
                  />
                </Box>
              }
              ranges={SUMMARY_RANGES}
              range={summaryRange}
              onRangeChange={(v) => {
                setSummaryRange(v);
                setSummaryPage(1);
              }}
              environments={environments.map((e) => e.id)}
              environment={summaryEnvironment}
              onEnvironmentChange={(v) => {
                setSummaryEnvironment(v);
                setSummaryPage(1);
              }}
              project={summaryProject}
              onProjectChange={(v) => {
                setSummaryProject(v);
                setSummaryPage(1);
              }}
              items={allSummaryItems}
              identifierType={summaryIdentifierType}
              onIdentifierTypeChange={(v) => {
                setSummaryIdentifierType(v);
                setSummaryPage(1);
              }}
              usedBy={summaryUsedBy}
              onUsedByChange={(v) => {
                setSummaryUsedBy(v);
                setSummaryPage(1);
              }}
              arrivalStatus={summaryArrivalStatus}
              onArrivalStatusChange={(v) => {
                setSummaryArrivalStatus(v);
                setSummaryPage(1);
              }}
            />
          </Box>

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
              <Table
                variant="list"
                size="md"
                className={summaryTableStyles.summaryTable}
              >
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Event Name</TableColumnHeader>
                    <TableColumnHeader>Trend</TableColumnHeader>
                    <TableColumnHeader>Total Count</TableColumnHeader>
                    <TableColumnHeader>Avg. Daily Users</TableColumnHeader>
                    <TableColumnHeader>Last Received</TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summaryVisibleItems.map((item) => (
                    <TableRow
                      key={item.eventName}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        const name = item.eventName.includes(" ")
                          ? `"${item.eventName}"`
                          : item.eventName;
                        const envPart = summaryEnvironment
                          ? ` env:${summaryEnvironment}`
                          : "";
                        setStreamSearch(`event:${name}${envPart}`);
                      }}
                    >
                      <TableCell>
                        <span className={summaryTableStyles.eventName}>
                          {item.eventName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Sparkline data={item.dailyCounts} width={90} />
                      </TableCell>
                      <TableCell>{formatCount(item.totalCount)}</TableCell>
                      <TableCell>{formatCount(item.dauCount)}</TableCell>
                      <TableCell>
                        <LastReceivedCell timestamp={item.lastReceived} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination carries 12px of its own vertical padding, which would
                otherwise stack with the card's 24px. Pull it back so the gap to
                the card edge reads as 24px. */}
              <Flex justify="between" align="center" mb="-3">
                <Flex gap="2" align="center">
                  <Text color="text-low" size="sm">
                    Rows per page
                  </Text>
                  <Select
                    size="sm"
                    value={String(summaryRowsPerPage)}
                    setValue={(v) => {
                      setSummaryRowsPerPage(Number(v));
                      setSummaryPage(1);
                    }}
                  >
                    {SUMMARY_ROWS_PER_PAGE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {String(n)}
                      </SelectItem>
                    ))}
                  </Select>
                </Flex>
                <Pagination
                  numItemsTotal={summaryItems.length}
                  perPage={summaryRowsPerPage}
                  currentPage={summaryCurrentPage}
                  onPageChange={setSummaryPage}
                  previousLabel={<PiCaretLeft size={14} />}
                  nextLabel={<PiCaretRight size={14} />}
                />
              </Flex>
            </>
          )}
        </Frame>
      </Box>

      {/* ---- Log stream section ---- */}
      <EventLogStream
        title="Log Stream"
        canFetch={canFetch}
        search={streamSearch}
        onSearchChange={setStreamSearch}
      />
    </div>
  );
}

function formatRelativeTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function LastReceivedCell({ timestamp }: { timestamp: string | null }) {
  if (!timestamp) {
    return <Text color="text-low">Never</Text>;
  }

  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) {
    return <Text color="text-low">{timestamp}</Text>;
  }

  const age = Date.now() - parsed;
  // Shared with the "Stopped arriving" filter so the two can never disagree.
  const stale = isStale(timestamp);
  const exact = formatTimestamp(timestamp);

  return (
    <Flex align="center" gap="2">
      <Text color={stale ? "text-high" : "text-mid"} title={exact}>
        {formatRelativeTime(age)}
      </Text>
      {stale && (
        <Badge
          label="Stale"
          size="xs"
          variant="soft"
          color="amber"
          radius="full"
        />
      )}
    </Flex>
  );
}
