import { useEffect } from "react";
import { Separator, Table } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Callout from "@/components/Radix/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import { IssueValue } from "./IssueTags";
import { StatusBadge } from "./StatusBadge";

export function PowerCard({
  experiment,
  snapshot,
  onNotify,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  onNotify: (issue: IssueValue) => void;
}) {
  const midPowerResults = snapshot.health?.power;

  const { getExperimentMetricById } = useDefinitions();

  useEffect(() => {
    if (midPowerResults?.lowPowerWarning) {
      onNotify({
        label: "Low Powered",
        value: "power-card",
      });
    }
  }, [midPowerResults, onNotify]);

  if (!midPowerResults) {
    return null;
  }

  console.log(midPowerResults);

  const metrics = Object.fromEntries(
    midPowerResults.metricVariationPowerResults.map((results) => [
      results.metricId,
      getExperimentMetricById(results.metricId),
    ])
  );

  console.log(metrics);

  const isLowPower = true;

  return (
    <div className="appbox container-fluid my-4 pl-3 py-3">
      <h2 className="d-inline">Experiment Power</h2>{" "}
      {midPowerResults?.lowPowerWarning ? (
        <StatusBadge status="Issues detected" />
      ) : null}
      <p className="mt-1">
        Show the likelihood of your experiment being statistically significant
        before the experiment duration.
      </p>
      <Separator size="4" my="3" />
      {!isLowPower ? (
        <Callout status="info">
          Your experiment is healthy and will likely be statistically
          significant before the experiment duration.
        </Callout>
      ) : (
        <>
          <Callout status="warning" mb="2">
            Your experiment is low-powered and will likely not be statistically
            significant before the configured end date.
          </Callout>
          <Table.Root variant="surface">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Variation</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Goal Metric</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>
                  Additional Days Needed
                </Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Message</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {midPowerResults.metricVariationPowerResults.map((r) => {
                const variationName = experiment.variations[r.variation].name;
                const metricName = metrics[r.metricId]?.name;

                return (
                  <Table.Row key={`${r.variation}-${r.metricId}`}>
                    <Table.Cell>{variationName}</Table.Cell>
                    <Table.Cell>{metricName}</Table.Cell>
                    <Table.Cell>{r.additionalDays}</Table.Cell>
                    <Table.Cell>
                      It is unlikely that this metric will be statistically
                      significant for the an effect size of{" "}
                      {r.effectSize?.toFixed(2)} before the experiment duration.
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
          <div className="mt-3">
            You can increase the power of your experiment by increasing the
            experiment duration (or increasing the exposure for more users).
          </div>
        </>
      )}
    </div>
  );
}
