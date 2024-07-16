import type { Response } from "express";
import { isFactMetric } from "shared/experiments";
import { getValidDate } from "shared/dates";
import {
  CreateMetricAnalysisProps,
  MetricAnalysisInterface,
  MetricAnalysisSettings,
} from "@back-end/types/metric-analysis";
import { createMetricAnalysis } from "../../services/metric-analysis";
import { MetricAnalysisQueryRunner } from "../../queryRunners/MetricAnalysisQueryRunner";
import { getExperimentMetricById } from "../../services/experiments";
import { getIntegrationFromDatasourceId } from "../../services/datasource";
import { getContextFromReq } from "../../services/organizations";
import { AuthRequest } from "../../types/AuthRequest";

export const postMetricAnalysis = async (
  req: AuthRequest<CreateMetricAnalysisProps>,
  res: Response<{ status: 200; metricAnalysis: MetricAnalysisInterface }>
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
    true
  );
  if (!context.permissions.canRunMetricQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }
  const metricAnalysisSettings: MetricAnalysisSettings = {
    dimensions: data.dimensions,
    userIdType: data.userIdType,
    lookbackDays: data.lookbackDays,
    startDate: getValidDate(data.startDate),
    endDate: getValidDate(data.endDate),
    populationType: data.populationType,
    populationId: data.populationId ?? null,
  };
  const metricAnalysis = await createMetricAnalysis(
    context,
    metricObj,
    metricAnalysisSettings
  );

  const model = metricAnalysis.model;
  res.status(200).json({
    status: 200,
    metricAnalysis: model,
  });
};

// Not needed?
// export const putMetricAnalysis = async (
//   req: AuthRequest<UpdateFactTableProps, { id: string }>,
//   res: Response<{ status: 200 }>
// ) => {
//   const data = req.body;
//   const context = getContextFromReq(req);

//   const factTable = await getFactTable(context, req.params.id);
//   if (!factTable) {
//     throw new Error("Could not find fact table with that id");
//   }

//   if (!context.permissions.canUpdateFactTable(factTable, data)) {
//     context.permissions.throwPermissionError();
//   }

//   const datasource = await getDataSourceById(context, factTable.datasource);
//   if (!datasource) {
//     throw new Error("Could not find datasource");
//   }

//   // Update the columns
//   data.columns = await runRefreshColumnsQuery(context, datasource, {
//     ...factTable,
//     ...data,
//   } as FactTableInterface);
//   data.columnsError = null;

//   if (!data.columns.some((col) => !col.deleted)) {
//     throw new Error("SQL did not return any rows");
//   }

//   await updateFactTable(context, factTable, data);

//   await addTagsDiff(context.org.id, factTable.tags, data.tags || []);

//   res.status(200).json({
//     status: 200,
//   });
// };

export const getMetricAnalysis = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200; metricAnalysis: MetricAnalysisInterface }>
) => {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id
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
  res: Response
) {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.getById(
    req.params.id
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
    metric.datasource
  );

  const queryRunner = new MetricAnalysisQueryRunner(
    context,
    metricAnalysis,
    integration
  );
  await queryRunner.cancelQueries();

  res.status(200).json({
    status: 200,
  });
}

export async function getLatestMetricAnalysis(
  req: AuthRequest<null, { metricid: string }>,
  res: Response<{ status: 200; metricAnalysis: MetricAnalysisInterface }>
) {
  const context = getContextFromReq(req);

  const metricAnalysis = await context.models.metricAnalysis.findLatestByMetric(
    req.params.metricid
  );

  if (!metricAnalysis) {
    throw new Error("Metric analysis not found");
  }

  res.status(200).json({
    status: 200,
    metricAnalysis,
  });
}
