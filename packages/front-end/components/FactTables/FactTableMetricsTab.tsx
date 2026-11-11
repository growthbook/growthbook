import { useEffect, useMemo, useRef } from "react";
import { Flex } from "@radix-ui/themes";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAddComputedFields, useSearch } from "@/services/search";
import { getMetricEvents } from "@/services/factTableEvents";
import { useExperiments } from "@/hooks/useExperiments";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import Link from "@/ui/Link";
import { TextField } from "@/ui/TextField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import columnStyles from "./FactTableDetailsPage.module.scss";

const PAGE_SIZE = 20;

export default function FactTableMetricsTab({
  factTable,
  metrics,
  eventColumns,
  highlightId,
}: {
  factTable: FactTableInterface;
  metrics: FactMetricInterface[];
  eventColumns: ColumnInterface[];
  // Set when arriving from an event's metric, which this row then marks
  highlightId: string | null;
}) {
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const { metricGroups } = useDefinitions();
  const { experiments } = useExperiments();
  const factMetricFlow = useFactMetricFlow("fact-table");

  // Experiment count per metric, including metrics added through a group
  const experimentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    experiments.forEach((exp) => {
      getAllMetricIdsFromExperiment(exp, true, metricGroups).forEach((id) =>
        counts.set(id, (counts.get(id) || 0) + 1),
      );
    });
    return counts;
  }, [experiments, metricGroups]);

  const columns = eventColumns.map((c) => c.column);
  const computed = useAddComputedFields(
    metrics,
    (m) => ({
      events: getMetricEvents(m, factTable.id, columns).join(
        m.metricType === "funnel" ? " → " : ", ",
      ),
      experiments: experimentCounts.get(m.id) || 0,
    }),
    [factTable.id, columns.join(), experimentCounts],
  );

  const {
    items,
    unpaginatedItems,
    searchInputProps,
    SortableTableColumnHeader,
    pagination,
    page,
    setPage,
  } = useSearch({
    items: computed,
    defaultSortField: "name",
    localStorageKey: "factTableMetricsTab",
    searchFields: ["name^3", "description", "events^2"],
    pageSize: PAGE_SIZE,
    // The Saved Filters tab on this page searches too, so neither owns ?q=
    disableUrlSearchTerm: true,
  });

  // Turn to the highlighted metric's page first, then scroll to it
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId) {
      jumpedTo.current = null;
      return;
    }
    if (jumpedTo.current === highlightId) return;
    const index = unpaginatedItems.findIndex((m) => m.id === highlightId);
    if (index < 0) return;
    const target = Math.floor(index / PAGE_SIZE) + 1;
    if (target !== page) {
      setPage(target);
      return;
    }
    jumpedTo.current = highlightId;
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightId, unpaginatedItems, page, setPage]);

  return (
    <Flex direction="column" gap="3">
      {factMetricFlow.modal}
      <Flex justify="between" align="center" gap="3">
        {metrics.length ? (
          <TextField
            size="sm"
            type="search"
            placeholder={`Search ${metrics.length} Fact Metrics`}
            {...searchInputProps}
          />
        ) : (
          <span />
        )}
        {factMetricFlow.createButton(
          { factTable: factTable.id },
          { children: "New Fact Metric", size: "sm", variant: "outline" },
        )}
      </Flex>
      {items.length ? (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <SortableTableColumnHeader field="name">
                Name
              </SortableTableColumnHeader>
              <SortableTableColumnHeader field="metricType">
                Type
              </SortableTableColumnHeader>
              {columns.length ? (
                <TableColumnHeader>Events</TableColumnHeader>
              ) : null}
              <SortableTableColumnHeader
                field="experiments"
                style={{ textAlign: "right" }}
              >
                Experiments
              </SortableTableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m) => (
              <TableRow
                key={m.id}
                align="center"
                ref={m.id === highlightId ? highlightRef : undefined}
                className={
                  m.id === highlightId ? columnStyles.highlightRow : undefined
                }
              >
                <TableCell>
                  <Link weight="bold" href={`/fact-metrics/${m.id}`}>
                    {m.name}
                  </Link>
                  <OfficialBadge type="metric" managedBy={m.managedBy} />
                </TableCell>
                <TableCell>
                  <FactMetricTypeDisplayName type={m.metricType} />
                </TableCell>
                {columns.length ? (
                  <TableCell>
                    <span className={columnStyles.mono}>{m.events}</span>
                  </TableCell>
                ) : null}
                <TableCell justify="end">{m.experiments}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Text color="text-mid">
          {metrics.length
            ? "No Fact Metrics match your search."
            : "No Fact Metrics use this Fact Table yet."}
        </Text>
      )}
      {pagination}
    </Flex>
  );
}
