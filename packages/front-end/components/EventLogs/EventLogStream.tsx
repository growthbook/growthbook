import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
import type { EventLogRecord } from "shared/validators";
import type { RowFilter } from "shared/types/fact-table";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import StreamPagination, {
  STREAM_DEFAULT_ROWS_PER_PAGE,
} from "@/components/Diagnostics/StreamPagination";
import Text from "@/ui/Text";
import { transformQuery } from "@/services/search";
import useApi from "@/hooks/useApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import EmptyState from "@/components/EmptyState";
import DataCardHeader from "@/components/Diagnostics/DataCardHeader";
import sharedStreamTableStyles from "@/components/Diagnostics/StreamTable.module.scss";
import StreamSearchField from "@/components/Diagnostics/StreamSearchField";
import EventLogDetailDrawer, {
  EVENT_LOG_DRAWER_ID,
} from "./EventLogDetailDrawer";
import EventLogStreamFilterPanel from "./EventLogStreamFilterPanel";
import {
  DEFAULT_TIME_FRAME,
  resolveEventLogTimeFrame,
  type EventLogTimeFrame,
} from "./EventLogTimeFramePanel";
import streamTableStyles from "./EventLogStreamTable.module.scss";
import { formatTimestamp, truncate } from "./eventLogUtils";

/**
 * The columns the records endpoint can filter on, known dimensions first so the
 * "+ Add filter" menu leads with them. `param` is the query-string key each one
 * maps to — the endpoint takes a fixed list and only understands equality,
 * which is why the builder is restricted to "=" below.
 */
const FILTER_COLUMNS: { column: string; label: string; param: string }[] = [
  { column: "environment", label: "Environment", param: "environment" },
  { column: "browser", label: "Browser", param: "browser" },
  { column: "os", label: "OS", param: "os" },
  { column: "country", label: "Country", param: "country" },
  { column: "sdk", label: "SDK", param: "sdk" },
  { column: "eventName", label: "Event name", param: "eventName" },
  { column: "userId", label: "User ID", param: "userId" },
];

const RECORDS_FILTER_KEYS = [
  "event",
  "user",
  "env",
  "browser",
  "os",
  "country",
  "sdk",
];

interface Props {
  /** Required: standalone and embedded hosts name this differently. */
  title: string;
  /** One quiet line under the title. */
  description?: string;
  /** Adds the "View all" link back to the full page. */
  embedded?: boolean;
  /** Wrap in a card. Hosts that supply their own container pass false. */
  card?: boolean;
  /** Gate from the host (plan + feature flag). Mirrors the previous behaviour. */
  canFetch: boolean;

  /**
   * Optional controlled search string. The standalone page drives this so that
   * clicking a row in the Summary table filters the stream — behaviour that
   * predates this extraction. Omit both and the component keeps its own state.
   */
  search?: string;
  onSearchChange?: (search: string) => void;
}

export default function EventLogStream({
  title,
  description,
  embedded,
  card = true,
  canFetch,
  search,
  onSearchChange,
}: Props) {
  const { project } = useDefinitions();

  // Ephemeral UI state — nothing here is persisted to an ExplorationConfig.
  const [timeFrame, setTimeFrame] =
    useState<EventLogTimeFrame>(DEFAULT_TIME_FRAME);
  const [panelFilters, setPanelFilters] = useState<RowFilter[]>([]);
  const [recordsPage, setRecordsPage] = useState(1);
  const [recordsRowsPerPage, setRecordsRowsPerPage] = useState(
    STREAM_DEFAULT_ROWS_PER_PAGE,
  );
  // No default search: the stream loads unfiltered.
  const [uncontrolledSearch, setUncontrolledSearch] = useState("");
  const recordsSearch = search ?? uncontrolledSearch;
  const setRecordsSearch = onSearchChange ?? setUncontrolledSearch;
  // The selected record, held here rather than in the drawer: it is already in
  // the loaded page, so opening the drawer never refetches.
  const [selectedEvent, setSelectedEvent] = useState<EventLogRecord | null>(
    null,
  );
  // Caret buttons by event id, so focus can return to the right one on close.
  const caretRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  // When the data on screen was fetched. SWR has no such timestamp of its own.
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

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

  const recordsQs = useMemo(() => {
    const resolved = resolveEventLogTimeFrame(timeFrame);
    const dateFrom = resolved.startDate.toISOString();
    const dateTo = resolved.endDate.toISOString();
    // As with the summary, the endpoint pages at a fixed 100 and the page
    // number is applied client-side, so it is not part of the request.
    const params = new URLSearchParams({ dateFrom, dateTo });
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

    // Equality-only, on the fixed columns above. Anything else cannot be
    // expressed in this request, and the builder is configured not to offer it.
    panelFilters.forEach((f) => {
      if (f.operator !== "=" || !f.column) return;
      const target = FILTER_COLUMNS.find((c) => c.column === f.column);
      const value = f.values?.[0];
      if (target && value) params.set(target.param, value);
    });

    return params.toString();
  }, [timeFrame, parsedFilters, panelFilters, project]);

  const {
    data: recordsData,
    error: recordsError,
    isValidating,
    mutate,
  } = useApi<{
    records: EventLogRecord[];
  }>(`/event-logs/records?${recordsQs}`, {
    shouldRun: () => canFetch,
  });

  useEffect(() => {
    if (recordsData) setUpdatedAt(new Date());
  }, [recordsData]);

  // Feeds the filter builder: the seven columns the endpoint understands, with
  // values drawn from the loaded rows so the value picker suggests real data.
  const columnSource = useMemo(() => {
    const loaded = recordsData?.records ?? [];
    const valuesFor = (column: string): string[] => {
      const pick = (r: EventLogRecord): string | null => {
        if (column === "environment") return r.environment;
        if (column === "browser") return r.uaBrowser;
        if (column === "os") return r.uaOs;
        if (column === "country") return r.geoCountry;
        if (column === "sdk") return r.sdkLanguage;
        if (column === "eventName") return r.eventName;
        if (column === "userId") return r.userId;
        return null;
      };
      return [...new Set(loaded.map(pick).filter(Boolean) as string[])].sort();
    };
    return {
      columns: FILTER_COLUMNS.map((c) => ({ label: c.label, value: c.column })),
      savedFilters: [],
      getColumnInfo: (column: string | undefined) => ({
        datatype: "string",
        topValues: column ? valuesFor(column) : [],
      }),
    };
  }, [recordsData]);

  const records = recordsData?.records ?? [];

  const recordsPageCount = Math.max(
    1,
    Math.ceil(records.length / recordsRowsPerPage),
  );
  const recordsCurrentPage = Math.min(recordsPage, recordsPageCount);
  const recordsVisible = records.slice(
    (recordsCurrentPage - 1) * recordsRowsPerPage,
    recordsCurrentPage * recordsRowsPerPage,
  );

  const body = (
    <>
      <DataCardHeader
        title={title}
        description={description}
        updatedAt={updatedAt}
        error={recordsError}
        refreshing={isValidating}
        onRefresh={() => mutate()}
        embedded={embedded}
      />

      {/* Search sits outside the panel, full width above both columns: it is
          the most-used control and has to survive the panel being collapsed. */}
      <Box mb="4">
        {/* Same component as the Summary search: magnifier inside the field,
            and the value commits on blur or Enter rather than per keystroke —
            each change is a warehouse query. */}
        <StreamSearchField
          placeholder="Search logs..."
          value={recordsSearch}
          onChange={(v) => {
            setRecordsSearch(v);
            setRecordsPage(1);
          }}
        />
      </Box>

      {/* align="stretch" so the panel matches the height of the table and its
          footer — its right-hand rule should run the full length of the
          content beside it, not stop where its own controls end. */}
      {/* 20px, not a Radix gap token: the scale jumps 16 -> 24. This is the
          space to the right of the panel's divider; the matching 20px to its
          left is the panel body's right inset. */}
      <Flex align="stretch" style={{ gap: 20 }}>
        <EventLogStreamFilterPanel
          timeFrame={timeFrame}
          onTimeFrameChange={(f) => {
            setTimeFrame(f);
            setRecordsPage(1);
          }}
          filters={panelFilters}
          onFiltersChange={(f) => {
            setPanelFilters(f);
            setRecordsPage(1);
          }}
          columnSource={columnSource}
        />

        {/* minWidth: 0 lets this flex child shrink below the table's
            min-content width; the table itself is fixed-layout so it fits
            rather than scrolling. */}
        <Box
          className={sharedStreamTableStyles.resultsArea}
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            maxWidth: "100%",
            // A full page of rows: the 30px header plus 30px per row.
            minHeight: 30 + recordsRowsPerPage * 30,
          }}
        >
          {recordsError && (
            <Callout status="warning">Failed to load event records</Callout>
          )}

          {!recordsData && !recordsError && (
            <Box className={sharedStreamTableStyles.resultsPlaceholder}>
              <Text color="text-mid">Loading event records...</Text>
            </Box>
          )}

          {recordsData && records.length === 0 && (
            <Box className={sharedStreamTableStyles.resultsPlaceholder}>
              <EmptyState
                title="No events found"
                description="Try a longer time frame, a different search, or removing a filter"
                leftButton={null}
                rightButton={null}
              />
            </Box>
          )}

          {recordsData && records.length > 0 && (
            <>
              <Table
                variant="list"
                size="md"
                className={`${sharedStreamTableStyles.streamTable} ${streamTableStyles.eventColumns}`}
              >
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
                  {recordsVisible.map((record) => {
                    const isSelected =
                      selectedEvent?.eventUuid === record.eventUuid;
                    const propsStr = JSON.stringify(record.properties);
                    return (
                      <TableRow
                        key={record.eventUuid}
                        style={{ cursor: "pointer" }}
                        className={`${streamTableStyles.row} ${
                          isSelected ? streamTableStyles.rowSelected : ""
                        }`}
                        onClick={() => setSelectedEvent(record)}
                      >
                        <TableCell>
                          <span>{formatTimestamp(record.timestamp)}</span>
                        </TableCell>
                        <TableCell>
                          {/* `truncate` is doing real work here: without it
                              @/ui/Text writes `white-space: normal` inline,
                              which beats the cell's nowrap and lets this
                              column wrap onto a second line. */}
                          {/* as="div" so it is a block: Radix's .rt-truncate
                              sets overflow/text-overflow but not display, and
                              neither applies to an inline span. */}
                          <Text
                            as="div"
                            size="sm"
                            weight="medium"
                            truncate
                            title={record.eventName}
                          >
                            {record.eventName}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <span title={record.userId ?? ""}>
                            {truncate(record.userId ?? "", 20)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span>{record.environment}</span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={streamTableStyles.propertiesValue}
                            title={propsStr}
                          >
                            {truncate(propsStr, 80)}
                          </span>
                          {/* A positioned overlay, not a sixth column: the
                              column set is unchanged. The last cell carries a
                              permanent right padding so this never collides
                              with its text, and nothing reflows on hover. */}
                          <button
                            type="button"
                            ref={(el) => {
                              caretRefs.current[record.eventUuid] = el;
                            }}
                            className={streamTableStyles.openCaret}
                            aria-label="Open event details"
                            aria-expanded={isSelected}
                            aria-controls={EVENT_LOG_DRAWER_ID}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(record);
                            }}
                          >
                            <PiCaretRight size={12} aria-hidden />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <StreamPagination
                numItemsTotal={records.length}
                perPage={recordsRowsPerPage}
                setPerPage={setRecordsRowsPerPage}
                currentPage={recordsCurrentPage}
                onPageChange={setRecordsPage}
                pullBottom={card}
              />
            </>
          )}
        </Box>
      </Flex>
    </>
  );

  const drawer = (
    <EventLogDetailDrawer
      event={selectedEvent}
      onClose={() => {
        const id = selectedEvent?.eventUuid;
        setSelectedEvent(null);
        // Focus returns to the caret that opened it.
        if (id) caretRefs.current[id]?.focus();
      }}
      onFilterByUser={(userId) => {
        setRecordsSearch(`user:${userId}`);
        setRecordsPage(1);
      }}
    />
  );

  if (!card) {
    return (
      <>
        {body}
        {drawer}
      </>
    );
  }

  // px/py rather than p: Frame hard-codes py="5" px="6" and a bare p would not
  // reliably win in the Radix class order.
  return (
    <>
      <Frame px="5" py="5">
        {body}
      </Frame>
      {drawer}
    </>
  );
}
