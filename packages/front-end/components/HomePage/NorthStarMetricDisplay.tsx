import React from "react";
import { MetricInterface } from "back-end/types/metric";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
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
  const permissions = usePermissions();
  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
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
  const status = getQueryStatus(metric.queries || [], metric.analysisError);
  const hasQueries = metric.queries?.length > 0;

  return (
    <>
      <div>
        {analysis && analysis?.dates && analysis.dates.length > 0 ? (
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
        ) : (
          <div className="mb-4">
            <h5 className="my-3">{metric.name}</h5>
            {permissions.check("runQueries", "") && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiCall(`/metric/${metric.id}/analysis`, {
                      method: "POST",
                    });
                    mutate();
                  } catch (e) {
                    console.error(e);
                  }
                }}
              >
                <RunQueriesButton
                  icon="refresh"
                  cta={analysis ? "Refresh Data" : "Run Analysis"}
                  initialStatus={getQueryStatus(
                    metric.queries || [],
                    metric.analysisError
                  )}
                  statusEndpoint={`/metric/${metric.id}/analysis/status`}
                  cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                  color="outline-primary"
                  position="left"
                  onReady={() => {
                    mutate();
                  }}
                />
              </form>
            )}
            {hasQueries && status === "failed" && (
              <div className="alert alert-danger my-3">
                Error running the analysis.
              </div>
            )}
            {hasQueries && status === "running" && (
              <div className="alert alert-info my-3">
                Your analysis is currently running.
              </div>
            )}
            <div className="mt-2">
              <em>
                No data for this metric yet. Click the{" "}
                {analysis ? "Refresh Data" : "Run Analysis"} button above.
              </em>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
export default NorthStarMetricDisplay;
