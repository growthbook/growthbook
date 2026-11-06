import { useMemo } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
import { OfficialBadge } from "@/components/Metrics/MetricName";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import columnStyles from "./ColumnList.module.scss";

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
    <div className={columnStyles.frame}>
      {factMetricFlow.modal}
      <Flex justify="end" px="4" py="3">
        {factMetricFlow.createButton(
          { factTable: factTable.id },
          { children: "New metric", size: "sm", variant: "outline" },
        )}
      </Flex>
      {visible.length ? (
        <table className={`table gbtable mb-0 ${columnStyles.detailsTable}`}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              {columns.length ? <th>Events</th> : null}
              <th style={{ textAlign: "right" }}>Experiments</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link weight="bold" href={`/fact-metrics/${m.id}`}>
                    {m.name}
                  </Link>
                  <OfficialBadge type="metric" managedBy={m.managedBy} />
                </td>
                <td>
                  <FactMetricTypeDisplayName type={m.metricType} />
                </td>
                {columns.length ? (
                  <td>
                    <span className={columnStyles.mono}>
                      {getMetricEvents(m, factTable.id, columns).join(
                        m.metricType === "funnel" ? " → " : ", ",
                      )}
                    </span>
                  </td>
                ) : null}
                <td style={{ textAlign: "right" }}>
                  {experimentCounts.get(m.id) || 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Box px="4" pb="3">
          <Text color="text-mid">No metrics use this Fact Table yet.</Text>
        </Box>
      )}
    </div>
  );
}
