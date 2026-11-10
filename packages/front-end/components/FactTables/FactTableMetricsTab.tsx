import { useEffect, useMemo, useRef } from "react";
import { Flex } from "@radix-ui/themes";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getMetricEvents } from "@/services/factTableEvents";
import { useExperiments } from "@/hooks/useExperiments";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import columnStyles from "./FactTableDetailsPage.module.scss";

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
  useEffect(() => {
    highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightId]);

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
  const visible = [...metrics].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Flex direction="column" gap="3">
      {factMetricFlow.modal}
      <Flex justify="end">
        {factMetricFlow.createButton(
          { factTable: factTable.id },
          { children: "New metric", size: "sm", variant: "outline" },
        )}
      </Flex>
      {visible.length ? (
        <Table variant="list" roundedCorners>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Type</TableColumnHeader>
              {columns.length ? (
                <TableColumnHeader>Events</TableColumnHeader>
              ) : null}
              <TableColumnHeader justify="end">Experiments</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((m) => (
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
                    <span className={columnStyles.mono}>
                      {getMetricEvents(m, factTable.id, columns).join(
                        m.metricType === "funnel" ? " → " : ", ",
                      )}
                    </span>
                  </TableCell>
                ) : null}
                <TableCell justify="end">
                  {experimentCounts.get(m.id) || 0}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Text color="text-mid">No metrics use this Fact Table yet.</Text>
      )}
    </Flex>
  );
}
