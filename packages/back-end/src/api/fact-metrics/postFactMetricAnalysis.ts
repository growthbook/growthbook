import { createApiRequestHandler } from "back-end/src/util/handler";
import { createMetricAnalysis } from "back-end/src/services/metric-analysis";
import { MetricAnalysisSettings } from "back-end/types/metric-analysis";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { PostFactMetricAnalysisResponse } from "back-end/types/openapi";
import { postFactMetricAnalysisValidator } from "back-end/src/validators/openapi";

export const postFactMetricAnalysis = createApiRequestHandler(
  postFactMetricAnalysisValidator,
)(async (req): Promise<PostFactMetricAnalysisResponse> => {
  const context = req.context;
  const id = req.params.id;

  const {
    userIdType,
    lookbackDays,
    populationType,
    populationId,
    useCache,
    additionalNumeratorFilters,
    additionalDenominatorFilters,
  } = req.body;

  const factMetric = await context.models.factMetrics.getById(id);

  if (!factMetric) {
    throw new Error("Fact metric not found");
  }

  const datasource = await getDataSourceById(context, factMetric.datasource);

  if (!datasource) {
    throw new Error("Datasource not found");
  }

  if (!req.context.permissions.canRunMetricQueries(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  if (
    !context.hasPremiumFeature("metric-populations") &&
    populationType !== "factTable"
  ) {
    throw new Error("Custom metric populations are a premium feature");
  }

  // Get fact table to determine default user ID types
  const factTableMap = await getFactTableMap(context);
  const factTable = factTableMap.get(factMetric.numerator.factTableId);
  if (!factTable) {
    throw new Error("Fact table not found");
  }

  // Create default settings similar to frontend defaults (getAnalysisSettingsForm)
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const lookbackDaysValue = lookbackDays ?? 30;
  const startDate = new Date(endOfToday);
  startDate.setDate(startDate.getDate() - lookbackDaysValue);
  startDate.setHours(0, 0, 0, 0);

  const metricAnalysisSettings: MetricAnalysisSettings = {
    userIdType: userIdType ?? factTable.userIdTypes?.[0] ?? "",
    startDate,
    endDate: endOfToday,
    lookbackDays: lookbackDaysValue,
    populationType: populationType ?? "factTable",
    populationId: populationId ?? null,
    additionalNumeratorFilters,
    additionalDenominatorFilters,
  };

  // Create the metric analysis
  const queryRunner = await createMetricAnalysis(
    context,
    factMetric,
    metricAnalysisSettings,
    "metric",
    useCache ?? true,
  );

  return {
    metricAnalysis: {
      id: queryRunner.model.id,
      status: queryRunner.model.status,
      settings: queryRunner.model.settings,
    },
  };
});
