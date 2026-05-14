import React from "react";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getMetricLink,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import { MetricInterface } from "shared/types/metric";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import RunQueriesButton, {
  getQueryStatus,
} from "@/components/Queries/RunQueriesButton";
import { useAuth } from "@/services/auth";
import { getExperimentMetricFormatter } from "@/services/metrics";
import DateGraph from "@/components/Metrics/DateGraph";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricName from "@/components/Metrics/MetricName";
import track from "@/services/track";
import useOrgSettings from "@/hooks/useOrgSettings";
import { getMetricAnalysisProps } from "@/components/MetricAnalysis/metric-analysis-props";
import Link from "@/ui/Link";

const NorthStarMetricDisplay = ({
  metricId,
  window: _window,
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
  const {
    project,
    getDatasourceById,
    getExperimentMetricById,
    getFactTableById,
  } = useDefinitions();

  const orgSettings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();

  const metric = getExperimentMetricById(metricId);

  const { data, error, mutate } = useApi<{
    data: {
      experiments: ExperimentInterfaceStringDates[];
      analysis: MetricAnalysisInterface | null;
      metric: MetricInterface | null;
    };
  }>(`/metrics/${metricId}/northstar`);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  if (!metric || !data) {
    return <LoadingOverlay />;
  }

  // @todo: get the metric period in days from the 'window'.
  // Disabled window range for now.
  const experiments = (
    project
      ? data.data.experiments.filter((e) => e.project === project)
      : data.data.experiments
  ).filter((e) => e.status !== "draft");

  const analysis = data.data.analysis;
  const { status } = getQueryStatus(analysis?.queries || [], analysis?.error);
  const hasQueries = (analysis?.queries?.length ?? 0) > 0;

  const datasource = getDatasourceById(metric.datasource);
  const formatter = getExperimentMetricFormatter(metric, getFactTableById);
  const factTable = isFactMetric(metric)
    ? getFactTableById(metric.numerator.factTableId)
    : undefined;

  return (
    <>
      <div className="mt-2">
        <div className="mb-4">
          <h4>
            <Link color="dark" href={getMetricLink(metric.id)}>
              <MetricName id={metric.id} disableTooltip />
            </Link>
          </h4>
          {analysis && analysis?.result?.dates?.length ? (
            <>
              <strong className="ml-4 align-bottom">
                Daily {isBinomialMetric(metric) ? "Average" : "Count"}
              </strong>
              <DateGraph
                type={isBinomialMetric(metric) ? "binomial" : "count"}
                formatter={formatter}
                dates={
                  analysis.result?.dates?.map((d) => {
                    return {
                      d: d.date,
                      v: d.mean,
                      s: d.stddev,
                      c: d.units,
                    };
                  }) ?? []
                }
                experiments={experiments}
                showStdDev={false}
                smoothBy={smoothBy === "week" ? "week" : "day"}
                height={300}
                method={isBinomialMetric(metric) ? "avg" : "sum"}
                onHover={onHoverCallback}
                hoverDate={hoverDate}
              />
            </>
          ) : (
            <>
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
              {status !== "running" && status !== "failed" && (
                <div className="mb-2">
                  <em>
                    No data for this metric yet. Click the{" "}
                    {analysis ? "Refresh Data" : "Run Analysis"} button below.
                  </em>
                </div>
              )}
            </>
          )}
          {datasource && permissionsUtil.canRunMetricQueries(datasource) ? (
            isFactMetric(metric) ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  //setError(null);
                  try {
                    const endOfToday = new Date();
                    // use end of day to allow query caching to work within local working day
                    endOfToday.setHours(23, 59, 59, 999);
                    const analysisDays = orgSettings?.metricAnalysisDays ?? 90;
                    const data = getMetricAnalysisProps({
                      id: metricId,
                      values: {
                        userIdType: factTable?.userIdTypes?.[0] ?? "user_id",
                        lookbackSelected: analysisDays + "",
                        lookbackDays: analysisDays,
                        populationType: "factTable",
                        populationId: null,
                        additionalNumeratorFilters: undefined,
                        additionalDenominatorFilters: undefined,
                      },
                      endOfToday,
                      source: "northstar",
                    });
                    track("MetricAnalysis_Update", {
                      type: metric.metricType,
                      populationType: data.populationType,
                      days: data.lookbackDays,
                      source: "northstar",
                    });
                    await apiCall(`/metric-analysis`, {
                      method: "POST",
                      body: JSON.stringify(data),
                    });
                    mutate();
                  } catch (e) {
                    //setError(e.message);
                  }
                }}
              >
                <RunQueriesButton
                  icon="refresh"
                  cta={analysis ? "Refresh Data" : "Run Analysis"}
                  mutate={mutate}
                  model={
                    analysis ?? {
                      queries: [],
                      runStarted: new Date(),
                    }
                  }
                  cancelEndpoint={`/metric-analysis/${analysis?.id}/cancel`}
                  color="outline-primary"
                  position="left"
                />
              </form>
            ) : (
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
                  model={
                    data.data.metric ?? {
                      queries: [],
                      runStarted: new Date(),
                    }
                  }
                  cancelEndpoint={`/metric/${metric.id}/analysis/cancel`}
                  color="outline-primary"
                  position="left"
                  mutate={mutate}
                />
              </form>
            )
          ) : null}
        </div>
      </div>
    </>
  );
};
export default NorthStarMetricDisplay;
