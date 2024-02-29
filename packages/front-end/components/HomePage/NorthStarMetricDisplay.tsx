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
import DateGraph from "@/components/Metrics/DateGraph";

const NorthStarMetricDisplay = ({
  metricId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  window,
  smoothBy,
  hoverDate,
  onHoverCallback,
}: {
  metricId: string;
  window?: number | string;
  smoothBy?: string;
  hoverDate?: number | null;
  onHoverCallback?: (ret: { d: number | null }) => void;
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
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'MetricAnaly... Remove this comment to see the full error message
    analysis = null;
  }
  const { status } = getQueryStatus(metric.queries || [], metric.analysisError);
  const hasQueries = metric.queries?.length > 0;

  return (
    <>
      <div className="mt-2">
        {analysis && analysis?.dates && analysis.dates.length > 0 ? (
          <div className="mb-4">
            <h4 className="mb-3">{metric.name}</h4>
            <strong className="ml-4 align-bottom">
              Daily {metric.type !== "binomial" ? "Average" : "Count"}
            </strong>
            <DateGraph
              type={metric.type}
              dates={analysis.dates}
              experiments={experiments}
              showStdDev={false}
              smoothBy={smoothBy === "week" ? "week" : "day"}
              height={300}
              method={metric.type !== "binomial" ? "avg" : "sum"}
              onHover={onHoverCallback}
              hoverDate={hoverDate}
            />
          </div>
        ) : (
          <div className="mb-4">
            <h4 className="my-3">{metric.name}</h4>
            {permissions.check("runQueries", metric.projects || []) && (
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
                  model={metric}
                  cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                  color="outline-primary"
                  position="left"
                  mutate={mutate}
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
