import {
  getLatestFactMetricAnalysisValidator,
  getMetricAnalysisValidator,
  postMetricAnalysisCancelValidator,
} from "shared/validators";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { MetricAnalysisQueryRunner } from "back-end/src/queryRunners/MetricAnalysisQueryRunner";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiMetricAnalysis(a: MetricAnalysisInterface) {
  const { result } = a;
  return {
    id: a.id,
    metric: a.metric,
    status: a.status,
    error: a.error,
    settings: {
      ...a.settings,
      startDate: a.settings.startDate.toISOString(),
      endDate: a.settings.endDate.toISOString(),
    },
    ...(result
      ? {
          result: {
            ...result,
            dates: result.dates?.map((d) => ({
              ...d,
              date: d.date.toISOString(),
            })),
          },
        }
      : {}),
    dateCreated: a.dateCreated.toISOString(),
    dateUpdated: a.dateUpdated.toISOString(),
  };
}

async function getAnalysis(context: ApiReqContext, id: string) {
  const analysis = await context.models.metricAnalysis.getById(id);
  if (!analysis) throw new NotFoundError(`Metric analysis not found: ${id}`);
  return analysis;
}

export const getMetricAnalysis = createApiRequestHandler(
  getMetricAnalysisValidator,
)(async (req) => ({
  metricAnalysis: toApiMetricAnalysis(
    await getAnalysis(req.context, req.params.id),
  ),
}));

export const getLatestFactMetricAnalysis = createApiRequestHandler(
  getLatestFactMetricAnalysisValidator,
)(async (req) => {
  const metric = await req.context.models.factMetrics.getById(req.params.id);
  if (!metric) throw new NotFoundError("Fact metric not found");
  const analysis = await req.context.models.metricAnalysis.findLatestByMetric(
    metric.id,
  );
  return { metricAnalysis: analysis ? toApiMetricAnalysis(analysis) : null };
});

export const postMetricAnalysisCancel = createApiRequestHandler(
  postMetricAnalysisCancelValidator,
)(async (req) => {
  const { context } = req;
  const analysis = await getAnalysis(context, req.params.id);
  const metric = await context.models.factMetrics.getById(analysis.metric);
  if (!metric?.datasource) {
    throw new NotFoundError("Could not find the metric's data source");
  }
  const integration = await getIntegrationFromDatasourceId(
    context,
    metric.datasource,
  );
  if (!context.permissions.canRunMetricQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }
  await new MetricAnalysisQueryRunner(
    context,
    analysis,
    integration,
  ).cancelQueries();
  return {
    metricAnalysis: toApiMetricAnalysis(
      await getAnalysis(context, analysis.id),
    ),
  };
});
