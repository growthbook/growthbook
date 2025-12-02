import type { Response } from "express";
import { isFactMetric } from "shared/experiments";
import { getValidDate } from "shared/dates";
import { stringToBoolean } from "shared/util";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "back-end/types/metric-analysis";
import { createMetricAnalysis } from "back-end/src/services/metric-analysis";
import { MetricAnalysisQueryRunner } from "back-end/src/queryRunners/MetricAnalysisQueryRunner";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { metricAnalysisSettingsValidator } from "./metric-analysis.validators";

export const postMetricAnalysis = async (
  req: AuthRequest<CreateMetricAnalysisProps>,
  res: Response<{ status: 200; metricAnalysis: MetricAnalysisInterface }>,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const metricObj = await getExperimentMetricById(context, data.id);
  if (!metricObj) {
    throw new Error("Metric not found");
  }

  if (!isFactMetric(metricObj)) {
    throw new Error("Metric is not a fact metric");
  }

  if (!metricObj.datasource) {
    return null;
  }

  const integration = await getIntegrationFromDatasourceId(
    context,
    metricObj.datasource,
    true,
  );
  if (
    !context.permissions.canRunMetricAnalysisQueries(integration.datasource)
  ) {
    context.permissions.throwPermissionError();
  }
  if (
    !context.hasPremiumFeature("metric-populations") &&
    data.populationType !== "factTable"
  ) {
    throw new Error("Custom metric populations are a premium feature");
  }

  const metricAnalysisSettings: MetricAnalysisSettings = {
    userIdType: data.userIdType,
    lookbackDays: data.lookbackDays,
    startDate: getValidDate(data.startDate),
    endDate: getValidDate(data.endDate),
    populationType: data.populationType,
    populationId: data.populationId ?? null,
    additionalNumeratorFilters: data.additionalNumeratorFilters,
    additionalDenominatorFilters: data.additionalDenominatorFilters,
  };

  const metricAnalysis = await createMetricAnalysis(
    context,
    metricObj,
    metricAnalysisSettings,
    data.source,
    !data.force,
  );

  const model = metricAnalysis.model;
  res.status(200).json({
    status: 200,
    metricAnalysis: model,
  });
};

export const getMetricAnalysis = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; metricAnalysis: MetricAnalysisInterface }>,
) => {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id,
  );

  if (!metricAnalysis) {
    throw new Error("Metric analysis not found");
  }

  res.status(200).json({
    status: 200,
    metricAnalysis,
  });
};

export async function cancelMetricAnalysis(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id,
  );

  if (!metricAnalysis) {
    throw new Error("Could not cancel query");
  }

  const metric = await getExperimentMetricById(context, metricAnalysis.metric);

  if (!metric?.datasource) {
    throw new Error("Could not cancel query, datasource not found");
  }
  const integration = await getIntegrationFromDatasourceId(
    context,
    metric.datasource,
  );

  const queryRunner = new MetricAnalysisQueryRunner(
    context,
    metricAnalysis,
    integration,
  );
  await queryRunner.cancelQueries();

  res.status(200).json({
    status: 200,
  });
}

export async function refreshMetricAnalysisStatus(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id,
  );

  if (!metricAnalysis) {
    throw new Error("Could not refresh metric analysis status");
  }

  const metric = await context.models.factMetrics.getById(
    metricAnalysis.metric,
  );

  if (!metric) {
    throw new Error(
      "Could not refresh metric analysis status, metric not found",
    );
  }
  if (!metric.datasource) {
    throw new Error(
      "Could not refresh metric analysis status, no datasource provided",
    );
  }
  const integration = await getIntegrationFromDatasourceId(
    context,
    metric.datasource,
  );

  const queryRunner = new MetricAnalysisQueryRunner(
    context,
    metricAnalysis,
    integration,
  );
  queryRunner.setMetric(metric);
  await queryRunner.refreshQueryStatuses();

  res.status(200).json({
    status: 200,
  });
}

export async function getLatestMetricAnalysis(
  req: AuthRequest<
    null,
    { metricid: string },
    { settings?: string; withHistogram?: string }
  >,
  res: Response<{
    status: 200;
    metricAnalysis: MetricAnalysisInterface | null;
  }>,
) {
  const context = getContextFromReq(req);

  // If we're trying to match specific analysis settings
  if (req.query.settings) {
    const rawSettings = JSON.parse(req.query.settings || "{}");
    // Fix dates
    rawSettings.startDate = getValidDate(rawSettings.startDate);
    rawSettings.endDate = getValidDate(rawSettings.endDate);

    const settings = metricAnalysisSettingsValidator.parse(rawSettings);

    const metricAnalysis =
      await context.models.metricAnalysis.findLatestBySettings(
        req.params.metricid,
        { settings, withHistogram: stringToBoolean(req.query.withHistogram) },
      );
    res.status(200).json({
      status: 200,
      metricAnalysis,
    });
    return;
  }

  // Otherwise, just find the latest one, regardless of settings
  const metricAnalysis = await context.models.metricAnalysis.findLatestByMetric(
    req.params.metricid,
  );

  res.status(200).json({
    status: 200,
    metricAnalysis,
  });
}

export async function getMetricAnalysisById(
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    metricAnalysis: MetricAnalysisInterface | null;
  }>,
) {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id,
  );

  if (!metricAnalysis) {
    throw new Error("Metric analysis not found");
  }

  res.status(200).json({
    status: 200,
    metricAnalysis,
  });
}
