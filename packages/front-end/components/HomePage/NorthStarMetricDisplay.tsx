import React from "react";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import DateGraph from "../Metrics/DateGraph";

const NorthStarMetricDisplay = ({
  metricId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  window,
  resolution,
}: {
  metricId: string;
  window?: number | string;
  resolution?: string;
}): React.ReactElement => {
  const { project } = useDefinitions();
  const { data, error } = useApi<{
    metric: MetricInterface;
    experiments: Partial<ExperimentInterfaceStringDates>[];
  }>(`/metric/${metricId}`);

  // @todo: get the metric period in days from the 'window'.

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // Disabled window range for now.

  const metric = data.metric;
  const experiments = project
    ? data.experiments.filter((e) => e.project === project)
    : data.experiments;
  let analysis = data.metric.analysis;
  if (!analysis || !("average" in analysis)) {
    analysis = null;
  }

  return (
    <>
      <div>
        {analysis && analysis?.dates && analysis.dates.length > 0 && (
          <div className="mb-4">
            <h5 className="mb-3">{metric.name}</h5>
            <DateGraph
              type={metric.type}
              dates={analysis.dates}
              experiments={experiments}
              showStdDev={false}
              groupby={resolution === "week" ? "week" : "day"}
              height={300}
            />
          </div>
        )}
      </div>
    </>
  );
};
export default NorthStarMetricDisplay;
