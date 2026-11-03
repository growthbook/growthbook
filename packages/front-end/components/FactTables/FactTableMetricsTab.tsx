import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { getAllMetricIdsFromExperiment } from "shared/experiments";
import {
  ColumnInterface,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getMetricEvents } from "@/services/factTables";
import { useExperiments } from "@/hooks/useExperiments";
import useFactMetricFlow from "@/hooks/useFactMetricFlow";
import MetricName from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function FactTableMetricsTab({
  factTable,
  metrics,
  eventColumns,
}: {
  factTable: FactTableInterface;
  metrics: FactMetricInterface[];
  eventColumns: ColumnInterface[];
}) {
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
  const visible = metrics
    .filter((m) => !m.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Flex direction="column" gap="3">
      {factMetricFlow.modal}
      <Flex justify="end">
        {factMetricFlow.createButton(
          { factTable: factTable.id },
          { children: "New metric" },
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
              <TableRow key={m.id}>
                <TableCell>
                  <Link href={`/fact-metrics/${m.id}`}>
                    <MetricName id={m.id} />
                  </Link>
                </TableCell>
                <TableCell>
                  <FactMetricTypeDisplayName type={m.metricType} />
                </TableCell>
                {columns.length ? (
                  <TableCell>
                    <code>
                      {getMetricEvents(m, factTable.id, columns).join(
                        m.metricType === "funnel" ? " → " : ", ",
                      )}
                    </code>
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
