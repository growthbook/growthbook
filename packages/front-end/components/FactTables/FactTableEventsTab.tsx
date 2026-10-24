import { Fragment, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCaretRightBold } from "react-icons/pi";
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
import Text from "@/ui/Text";
import FactTableSampleRows from "./FactTableSampleRows";
import { LoadRowCountsButton, useTopValuesLookbackDays } from "./ColumnValues";

export default function FactTableEventsTab({
  factTable,
  eventColumns,
  metrics,
  valueCounts,
  canLoadCounts,
}: {
  factTable: FactTableInterface;
  eventColumns: ColumnInterface[];
  metrics: FactMetricInterface[];
  valueCounts: ReturnType<typeof useColumnValueCounts>;
  canLoadCounts: boolean;
}) {
  const [columnName, setColumnName] = useState(eventColumns[0].column);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const lookbackDays = useTopValuesLookbackDays();

  // The selected column can disappear after a column refresh
  const column =
    eventColumns.find((c) => c.column === columnName) || eventColumns[0];
  const counts = valueCounts.counts[column.column];
  const rows: { value: string; count?: number }[] =
    counts ?? (column.topValues || []).map((value) => ({ value }));
  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.value.toLowerCase().includes(q));

  return (
    <Flex direction="column" gap="3">
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
        {canLoadCounts && !counts ? (
          <LoadRowCountsButton
            loading={!!valueCounts.loading[column.column]}
            error={valueCounts.errors[column.column]}
            onLoad={() => valueCounts.load(column.column)}
          />
        ) : null}
      </Flex>

      {rows.length === 0 ? (
        <Text color="text-mid">
          No values found for <code>{column.column}</code> yet. Refresh the
          columns to load them.
        </Text>
      ) : (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader style={{ width: 32 }} />
              <TableColumnHeader>Event</TableColumnHeader>
              {counts ? <TableColumnHeader>Rows</TableColumnHeader> : null}
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
                      <code>{r.value}</code>
                    </TableCell>
                    {counts ? (
                      <TableCell>{r.count?.toLocaleString()}</TableCell>
                    ) : null}
                    <TableCell>{eventMetrics.length || "—"}</TableCell>
                  </TableRow>
                  {isOpen ? (
                    <TableRow>
                      <TableCell colSpan={counts ? 4 : 3}>
                        <Flex direction="column" gap="3" py="2">
                          <Box>
                            <Text weight="semibold" as="div" mb="1">
                              Metrics
                            </Text>
                            {eventMetrics.length ? (
                              <Flex gap="3" wrap="wrap">
                                {eventMetrics.map((m) => (
                                  <Link
                                    key={m.id}
                                    href={`/fact-metrics/${m.id}`}
                                  >
                                    {m.name}
                                  </Link>
                                ))}
                              </Flex>
                            ) : (
                              <Text color="text-mid">
                                No metrics use this event yet.
                              </Text>
                            )}
                          </Box>
                          <FactTableSampleRows
                            key={`${column.column}:${r.value}`}
                            factTableId={factTable.id}
                            rowFilters={[
                              {
                                column: column.column,
                                operator: "=",
                                values: [r.value],
                              },
                            ]}
                          />
                        </Flex>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
            {!visible.length ? (
              <TableRow>
                <TableCell colSpan={counts ? 4 : 3}>
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
