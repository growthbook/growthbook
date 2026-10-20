import { getLatestFactMetricAnalysisValidator } from "shared/validators";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getLatestFactMetricAnalysis = createApiRequestHandler(
  getLatestFactMetricAnalysisValidator,
)(async (req) => {
  const metric = await req.context.models.factMetrics.getById(req.params.id);
  if (!metric) throw new NotFoundError("Could not find the Fact Metric.");
  const analysis = await req.context.models.metricAnalysis.findLatestByMetric(
    metric.id,
  );
  return {
    metricAnalysis: analysis
      ? req.context.models.metricAnalysis.toApiInterface(analysis)
      : null,
  };
});
