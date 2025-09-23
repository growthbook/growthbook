import { getFactMetricById } from "back-end/src/models/FactMetricModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postFactMetricAnalysisValidator } from "back-end/src/validators/openapi";
import { createMetricAnalysis } from "back-end/src/services/metric-analysis";
import { MetricAnalysisSource } from "back-end/types/metric-analysis";

export const postFactMetricAnalysis = createApiRequestHandler(
  postFactMetricAnalysisValidator,
)(async (req) => {
  const context = req.context;
  const id = req.params.id;

  const {
    userIdType,
    lookbackDays,
    populationType,
    populationId,
    source,
    force,
  } = req.body;

  const factMetric = await getFactMetricById(context, id);

  if (!factMetric) {
    throw new Error("Fact metric not found");
  }

  if (!factMetric.datasource) {
    throw new Error("No datasource set for fact metric");
  }

  if (
    !req.context.permissions.canRunMetricQueries({ id: factMetric.datasource })
  ) {
    req.context.permissions.throwPermissionError();
  }

  const metricAnalysisSettings = {
    userIdType,
    lookbackDays,
    populationType,
    populationId,
  };

  const analysisSource: MetricAnalysisSource = source ?? "metric";

  // Create the metric analysis
  const queryRunner = await createMetricAnalysis(
    context,
    factMetric,
    metricAnalysisSettings,
    analysisSource,
    !force, // useCache is the inverse of force
  );

  await req.audit({
    event: "metric.analysis",
    entity: {
      object: "factMetric",
      id: factMetric.id,
    },
    details: auditDetailsCreate({
      userIdType: metricAnalysisSettings.userIdType,
      lookbackDays: metricAnalysisSettings.lookbackDays,
      populationType: metricAnalysisSettings.populationType,
      populationId: metricAnalysisSettings.populationId,
      source: analysisSource,
      force: force ?? false,
    }),
  });

  return {
    metricAnalysis: {
      id: queryRunner.model.id,
      status: queryRunner.model.status,
    },
  };
});
