import { z } from "zod";
import type { Response } from "express";
import {
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ExperimentSnapshotSettings } from "back-end/types/experiment-snapshot";
import { PopulationDataInterface } from "back-end/types/population-data";
import {
  PopulationDataQueryRunner,
  PopulationDataQuerySettings,
} from "back-end/src/queryRunners/PopulationDataQueryRunner";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { createPopulationDataPropsValidator } from "back-end/src/routers/population-data/population-data.validators";

// move
type CreatePopulationDataProps = z.infer<
  typeof createPopulationDataPropsValidator
>;

export const postPopulationData = async (
  req: AuthRequest<CreatePopulationDataProps>,
  res: Response<{ status: 200; populationData: PopulationDataInterface }>
) => {
  const data = req.body;
  const context = getContextFromReq(req);

  // metric permissions

  // get metrics and validate same datasource

  // GET existing, do logic to find metric diffs
  const today = new Date();
  const eightWeeksAgo = new Date(today);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 7 * 520); // change to 7 * 8

  const snapshotSettings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    metricSettings: [], // TODO
    goalMetrics: data.metrics,
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
    exposureQueryId: "", // todo
    startDate: eightWeeksAgo,
    endDate: today,
    variations: [],
  };

  const integration = await getIntegrationFromDatasourceId(
    context,
    data.datasourceId,
    true
  );
  // if (
  //   !context.permissions.canRunMetricAnalysisQueries(integration.datasource)
  // ) {
  //   context.permissions.throwPermissionError();
  // }
  // if (
  //   !context.hasPremiumFeature("metric-populations") &&
  //   data.populationType !== "factTable"
  // ) {
  //   throw new Error("Custom metric populations are a premium feature");
  // }

  // base model TODO

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

    // TODO
    units: [],
    metrics: [],
  });
  const queryRunner = new PopulationDataQueryRunner(
    context,
    model,
    integration,
    true
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
  req: AuthRequest<null, { id: string | null }>,
  res: Response<{ status: 200; populationData: PopulationDataInterface | null }>
) => {
  const context = getContextFromReq(req);

  // TODO don't do round trip to db for this
  if (req.params.id === null) {
    res.status(200).json({
      status: 200,
      populationData: null,
    });
    return;
  }

  const populationData = await context.models.populationData.getById(
    req.params.id
  );

  if (!populationData) {
    throw new Error("PopulationData not found");
  }

  res.status(200).json({
    status: 200,
    populationData,
  });
};

export const getPopulationDataBySourceId = async (
  req: AuthRequest<null, { sourceId: string }>,
  res: Response<{ status: 200; populationData: PopulationDataInterface | null }>
) => {
  const context = getContextFromReq(req);

  const populationData = await context.models.populationData.getLatestBySourceId(
    req.params.sourceId
  );

  if (!populationData) {
    throw new Error("PopulationData not found");
  }

  res.status(200).json({
    status: 200,
    populationData,
  });
};

export async function cancelPopulationData(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);

  const populationData = await context.models.populationData.getById(
    req.params.id
  );

  if (!populationData) {
    throw new Error("Could not cancel query");
  }

  const datasource = await getDataSourceById(
    context,
    populationData.datasourceId
  );

  if (!datasource) {
    throw new Error("Could not cancel query, datasource not found");
  }

  const integration = await getSourceIntegrationObject(
    // ask about decryption
    context,
    datasource
  );

  const queryRunner = new PopulationDataQueryRunner(
    context,
    populationData,
    integration
  );
  await queryRunner.cancelQueries();

  res.status(200).json({
    status: 200,
  });
}
