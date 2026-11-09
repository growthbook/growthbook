import { Fragment, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiArrowClockwise, PiCaretRightBold, PiInfo } from "react-icons/pi";
import { ago } from "shared/dates";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { getMetricsForEvent } from "@/services/factTables";
import useColumnValueCounts from "@/hooks/useColumnValueCounts";
import TextField from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import FactTableSampleRows from "./FactTableSampleRows";
import styles from "./FactTableEventsTab.module.scss";
import columnStyles from "./FactTableDetailsPage.module.scss";
import { CountBar, useTopValuesLookbackDays } from "./ColumnValues";

// Keeps an expanded row's height close to the sample rows beside it
const MAX_METRICS = 5;

export default function FactTableEventsTab({
  factTable,
  eventColumns,
  metrics,
  valueCounts,
  canRefresh,
  onShowMetrics,
  onSelectMetric,
}: {
  factTable: FactTableInterface;
  eventColumns: ColumnInterface[];
  metrics: FactMetricInterface[];
  valueCounts: ReturnType<typeof useColumnValueCounts>;
  canRefresh: boolean;
  onShowMetrics: (column: string, value: string) => void;
  onSelectMetric: (metricId: string) => void;
}) {
  const [columnName, setColumnName] = useState(eventColumns[0].column);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const lookbackDays = useTopValuesLookbackDays();
  const factMetricFlow = useFactMetricFlow("fact-table-events");

  // The selected column can disappear after a column refresh
  const column =
    eventColumns.find((c) => c.column === columnName) || eventColumns[0];
  // Columns saved before counts existed show values only until refreshed
  const counts = column.topValueCounts?.length
    ? column.topValueCounts
    : undefined;
  const rows: { value: string; count?: number }[] =
    counts ?? (column.topValues || []).map((value) => ({ value }));
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.value.toLowerCase().includes(q));
  // Total of the listed events only; the table's full row count is unknown
  const totalCount = Math.max(
    1,
    rows.reduce((sum, r) => sum + (r.count ?? 0), 0),
  );

  return (
    <Flex direction="column" gap="3">
      {factMetricFlow.modal}
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Flex gap="2" align="center">
          {eventColumns.length > 1 &&
            eventColumns.map((c) => (
              <Button
                key={c.column}
                size="sm"
                variant={c.column === column.column ? "soft" : "ghost"}
                onClick={() => {
                  setColumnName(c.column);
                  setOpen(null);
                }}
              >
                {c.column}
              </Button>
            ))}
          <TextField
            size="sm"
            type="search"
            placeholder={`Search ${rows.length} events`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Flex>
        <Flex align="center" gap="3">
          {column.topValuesDate ? (
            <Text color="text-mid">Refreshed {ago(column.topValuesDate)}</Text>
          ) : null}
          {canRefresh ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<PiArrowClockwise />}
              loading={!!valueCounts.loading[column.column]}
              onClick={() => valueCounts.load(column.column)}
            >
              Refresh
            </Button>
          ) : null}
        </Flex>
      </Flex>
      {valueCounts.errors[column.column] ? (
        <Text size="sm" color="text-low">
          Couldn&apos;t refresh events: {valueCounts.errors[column.column]}
        </Text>
      ) : null}

      {rows.length === 0 ? (
        <Text color="text-mid">
          No values found for{" "}
          <span className={columnStyles.mono}>{column.column}</span> yet.
          {canRefresh ? " Refresh to load them." : ""}
        </Text>
      ) : (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 32 }} />
              <TableColumnHeader>Event</TableColumnHeader>
              {counts ? (
                <>
                  <TableColumnHeader>Rows</TableColumnHeader>
                  <TableColumnHeader>
                    <Tooltip
                      content={`Each event's share of all rows across the top ${rows.length} events from the last ${lookbackDays} days. Rows from events not listed aren't counted.`}
                    >
                      <Flex align="center" gap="1" display="inline-flex">
                        Share <PiInfo />
                      </Flex>
                    </Tooltip>
                  </TableColumnHeader>
                </>
              ) : null}
              <TableColumnHeader>Metrics</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => {
              const isOpen = open === r.value;
              const eventMetrics = getMetricsForEvent(
                metrics,
                factTable.id,
                column.column,
                r.value,
              );
              return (
                <Fragment key={r.value}>
                  <TableRow
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpen(isOpen ? null : r.value)}
                  >
                    <TableCell>
                      <IconButton
                        variant="ghost"
                        size="1"
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${r.value}`}
                      >
                        <PiCaretRightBold
                          style={{
                            transform: isOpen ? "rotate(90deg)" : undefined,
                          }}
                        />
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <span className={columnStyles.mono}>{r.value}</span>
                    </TableCell>
                    {counts ? (
                      <>
                        <TableCell>{r.count?.toLocaleString()}</TableCell>
                        <TableCell>
                          <CountBar count={r.count} max={totalCount} />
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell>{eventMetrics.length || "—"}</TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell colSpan={counts ? 5 : 3}>
                        <Flex gap="5" py="3" px="4" align="start">
                          <Box flexGrow="1" minWidth="0">
                            <div className={styles.sectionLabel}>
                              Sample rows
                            </div>
                            <FactTableSampleRows
                              key={`${column.column}:${r.value}`}
                              factTableId={factTable.id}
                              compact
                              rowFilters={[
                                {
                                  column: column.column,
                                  operator: "=",
                                  values: [r.value],
                                },
                              ]}
                            />
                          </Box>
                          <Box flexShrink="0" style={{ width: 240 }}>
                            <div className={styles.sectionLabel}>Metrics</div>
                            <Flex direction="column" align="start" gap="2">
                              {eventMetrics.slice(0, MAX_METRICS).map((m) => (
                                <Button
                                  key={m.id}
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onSelectMetric(m.id)}
                                  title={m.name}
                                  style={{ maxWidth: "100%" }}
                                >
                                  <span className={styles.truncate}>
                                    {m.name}
                                  </span>
                                </Button>
                              ))}
                              {eventMetrics.length > MAX_METRICS ? (
                                <Link
                                  onClick={() =>
                                    onShowMetrics(column.column, r.value)
                                  }
                                >
                                  +{eventMetrics.length - MAX_METRICS} more
                                </Link>
                              ) : null}
                              {factMetricFlow.createButton(
                                { factTable: factTable.id },
                                { size: "sm" },
                              )}
                            </Flex>
                          </Box>
                        </Flex>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {!visible.length ? (
              <TableRow>
                <TableCell colSpan={counts ? 5 : 3}>
                  <Text color="text-mid">No events match “{search}”.</Text>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}
      {rows.length ? (
        <Text size="sm" color="text-low">
          Top {rows.length} events over the last {lookbackDays} days
          {counts ? ". Counts may be approximate on some data sources." : ""}
        </Text>
      ) : null}
    </Flex>
  );
}
