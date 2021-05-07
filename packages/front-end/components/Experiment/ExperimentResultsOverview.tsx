import React from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import MetricResults from "./MetricResults";
import SRMWarning from "./SRMWarning";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";

export default function ExperimentResultsOverview({
  experiment,
  snapshot,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  openEditModal?: () => void;
}): React.ReactElement {
  const metrics = experiment.metrics;

  return (
    <div>
      <SRMWarning srm={snapshot?.results?.[0]?.srm} />
      <div className="mt-4">
        {metrics.map((k) => (
          <MetricResults
            snapshot={snapshot}
            metric={k}
            key={k}
            variationNames={experiment.variations.map((v) => v.name)}
          />
        ))}
      </div>
    </div>
  );
}
