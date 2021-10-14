import React from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import DateGraph from "../Metrics/DateGraph";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";

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

  // TODO
  // Autoupdate metrics - cron job similar to the exp update. OR add a refresh button.
  // Disable window range for now.
  // Settings have permissiong built in. Can move modal there.
  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  const metric = data.metric;
  const experiments = data.experiments;
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
