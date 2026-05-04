import { z } from "zod";
import type { Response } from "express";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { PopulationDataInterface } from "shared/types/population-data";
import type { PopulationDataQuerySettings } from "shared/types/query";
import { createPopulationDataPropsValidator } from "shared/validators";
import {
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { PopulationDataQueryRunner } from "back-end/src/queryRunners/PopulationDataQueryRunner";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { PrivateApiErrorResponse } from "back-end/types/api";

type CreatePopulationDataProps = z.infer<
  typeof createPopulationDataPropsValidator
>;

export const postPopulationData = async (
  req: AuthRequest<CreatePopulationDataProps>,
  res: Response<
    | { status: 200; populationData: PopulationDataInterface }
    | PrivateApiErrorResponse
  >,
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  const today = new Date();
  // TODO customizable lookback window
  const eightWeeksAgo = new Date(today);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 8);

  const integration = await getIntegrationFromDatasourceId(
    context,
    data.datasourceId,
    true,
  );

  if (
    !context.permissions.canRunPopulationDataQueries(integration.datasource)
  ) {
    context.permissions.throwPermissionError();
  }
  if (!context.hasPremiumFeature("historical-power")) {
    return res.status(403).json({
      status: 403,
      message: "Query-based power calculations are a pro feature",
    });
  }

  // see if one exists from the last 7 days
  const populationData =
    await context.models.populationData.getRecentUsingSettings(
      data.sourceId,
      data.userIdType,
    );

  const snapshotSettings: ExperimentSnapshotSettings = {
    dimensions: [],
    metricSettings: [],
    goalMetrics: data.metricIds,
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      proper: false,
      mean: 0,
      stddev: 0,
      override: false,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: data.datasourceId,
    exposureQueryId: "",
    startDate: eightWeeksAgo,
    endDate: today,
    variations: [],
  };

  // TODO hash metric and datasource to validate cache and let force refresh override
  // TODO incrementally update metrics
  if (
    !data.force &&
    populationData &&
    populationData.datasourceId === data.datasourceId
  ) {
    const populationMetrics = populationData.metrics.map((m) => m.metricId);
    // only ask for new metrics
    snapshotSettings.goalMetrics = data.metricIds.filter(
      (m) => !populationMetrics.includes(m),
    );
    if (snapshotSettings.goalMetrics.length === 0) {
      return res.status(200).json({
        status: 200,
        populationData,
      });
    }
    // TODO: incrementally do an update
  }

  const populationSettings: PopulationDataQuerySettings = {
    startDate: eightWeeksAgo,
    endDate: today,
    userIdType: data.userIdType,
    sourceType: data.sourceType,
    sourceId: data.sourceId,
  };

  const model = await context.models.populationData.create({
    ...populationSettings,

    datasourceId: data.datasourceId,
    queries: [],
    runStarted: null,
    status: "running",

    units: [],
    metrics: [],
  });
  const queryRunner = new PopulationDataQueryRunner(
    context,
    model,
    integration,
    true,
  );

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  await queryRunner
    .startAnalysis({
      populationSettings,
      snapshotSettings,
      metricMap,
      factTableMap,
    })
    .catch((e) => {
      context.models.populationData.updateById(model.id, {
        status: "error",
        error: e.message,
      });
    });

  res.status(200).json({
    status: 200,
    populationData: queryRunner.model,
  });
};

export const getPopulationData = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{
    status: 200;
    populationData: PopulationDataInterface | null;
  }>,
) => {
  const context = getContextFromReq(req);

  const populationData = await context.models.populationData.getById(
    req.params.id,
  );

  if (!populationData) {
    context.throwNotFoundError("PopulationData not found");
  }

  res.status(200).json({
    status: 200,
    populationData,
  });
};

export async function cancelPopulationData(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  const populationData = await context.models.populationData.getById(
    req.params.id,
  );

  if (!populationData) {
    return context.throwNotFoundError("Could not cancel query");
  }

  const datasource = await getDataSourceById(
    context,
    populationData.datasourceId,
  );

  if (!datasource) {
    return context.throwNotFoundError(
      "Could not cancel query, datasource not found",
    );
  }

  const integration = await getSourceIntegrationObject(context, datasource);

  const queryRunner = new PopulationDataQueryRunner(
    context,
    populationData,
    integration,
  );
  await queryRunner.cancelQueries();

  res.status(200).json({
    status: 200,
  });
}
