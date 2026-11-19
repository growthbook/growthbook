import { Fragment, useState } from "react";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { PiArrowClockwise, PiCaretRightBold } from "react-icons/pi";
import { ago } from "shared/dates";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import {
  getColumnTopValues,
  getTopValuesNote,
} from "@/services/factTableColumns";
import { getMetricsForEvent } from "@/services/factTableEvents";
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
import HelperText from "@/ui/HelperText";
import SegmentedControl from "@/ui/SegmentedControl";
import Tooltip from "@/ui/Tooltip";
import FactTableSampleRows from "./FactTableSampleRows";
import styles from "./FactTableEventsTab.module.scss";
import columnStyles from "./FactTableDetailsPage.module.scss";
import {
  CountCells,
  CountColumnHeaders,
  useTopValuesLookbackDays,
} from "./ColumnValues";

// Five lines of two, about the height of the sample rows beside them
const MAX_METRICS = 10;

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
  const topValues = getColumnTopValues(
    column,
    valueCounts.counts[column.column],
  );
  const rows = topValues.values;
  const showCounts = topValues.hasCounts;
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
          {eventColumns.length > 1 ? (
            <SegmentedControl
              aria-label="Event column"
              size="sm"
              value={column.column}
              setValue={(v) => {
                setColumnName(v);
                setOpen(null);
              }}
              options={eventColumns.map((c) => ({
                value: c.column,
                label: c.column,
              }))}
            />
          ) : null}
          {rows.length > 0 ? (
            <TextField
              size="sm"
              type="search"
              placeholder={`Search ${rows.length} events`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
        </Flex>
        <Flex align="center" gap="3">
          {topValues.refreshedAt ? (
            <Text size="sm" color="text-mid">
              Refreshed {ago(topValues.refreshedAt)}
            </Text>
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
        <HelperText status="error" size="sm">
          Couldn&apos;t refresh events: {valueCounts.errors[column.column]}
        </HelperText>
      ) : null}

      {rows.length === 0 ? (
        <Text color="text-mid">
          No values found for{" "}
          <span className={columnStyles.mono}>{column.column}</span>
          {topValues.refreshedAt
            ? ` in the last ${lookbackDays} days.`
            : ` yet.${canRefresh ? " Refresh to load them." : ""}`}
        </Text>
      ) : (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 32 }} />
              <TableColumnHeader>Event</TableColumnHeader>
              {showCounts ? (
                <CountColumnHeaders
                  noun="event"
                  count={rows.length}
                  lookbackDays={lookbackDays}
                />
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
                    align="center"
                    className={isOpen ? columnStyles.openRow : undefined}
                    style={{ cursor: "pointer" }}
                    onClick={() => setOpen(isOpen ? null : r.value)}
                  >
                    <TableCell className={columnStyles.iconCell}>
                      <IconButton
                        variant="ghost"
                        size="1"
                        aria-expanded={isOpen}
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
                    {showCounts ? (
                      <CountCells count={r.count} max={totalCount} />
                    ) : null}
                    <TableCell>{eventMetrics.length || "—"}</TableCell>
                  </TableRow>
                  {isOpen ? (
                    // Starts under the event name so it reads as part of the row
                    <TableRow data-no-hover>
                      <TableCell />
                      <TableCell colSpan={showCounts ? 4 : 2}>
                        <Flex gap="5" py="3" align="start">
                          <Box flexGrow="1" minWidth="0">
                            <Text
                              as="div"
                              size="sm"
                              weight="semibold"
                              color="text-mid"
                              textTransform="uppercase"
                              mb="2"
                            >
                              Sample rows
                            </Text>
                            <FactTableSampleRows
                              key={`${column.column}:${r.value}`}
                              factTable={factTable}
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
                          <Box flexShrink="0" width="33%">
                            <Text
                              as="div"
                              size="sm"
                              weight="semibold"
                              color="text-mid"
                              textTransform="uppercase"
                              mb="2"
                            >
                              Metrics
                            </Text>
                            <Flex direction="column" align="start" gap="2">
                              {/* Two equal buttons per line; long names truncate */}
                              <Grid
                                columns="repeat(2, minmax(0, 1fr))"
                                gap="2"
                                width="100%"
                              >
                                {eventMetrics.slice(0, MAX_METRICS).map((m) => (
                                  // Long names truncate; the tooltip also
                                  // shows on keyboard focus
                                  <Tooltip key={m.id} content={m.name}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => onSelectMetric(m.id)}
                                      className={styles.metricButton}
                                    >
                                      {m.name}
                                    </Button>
                                  </Tooltip>
                                ))}
                              </Grid>
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
                <TableCell colSpan={showCounts ? 5 : 3}>
                  <Text color="text-mid">No events match “{search}”.</Text>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      )}
      {rows.length ? (
        <Text size="sm" color="text-low">
          {getTopValuesNote({
            count: rows.length,
            noun: "event",
            lookbackDays,
            hasCounts: showCounts,
            countsUnavailable: topValues.countsUnavailable,
            canRefresh,
          })}
        </Text>
      ) : null}
    </Flex>
  );
}
