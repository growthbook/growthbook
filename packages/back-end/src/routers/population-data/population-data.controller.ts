import { z } from "zod";
import md5 from "md5";
import type { Response } from "express";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { PopulationDataInterface } from "shared/types/population-data";
import type { PopulationDataQuerySettings } from "shared/types/query";
import { DataSourceInterface } from "shared/types/datasource";
import { SegmentInterface } from "shared/types/segment";
import { FactTableInterface } from "shared/types/fact-table";
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
import {
  getFactTableMap,
  FactTableMap,
} from "back-end/src/models/FactTableModel";
import { PrivateApiErrorResponse } from "back-end/types/api";

type CreatePopulationDataProps = z.infer<
  typeof createPopulationDataPropsValidator
>;

const hashObject = (obj: object) => md5(JSON.stringify(obj));

// Cache-validation hashes for population data. These are version stamps
// (id + dateUpdated of every definition the queries read), not field-by-field
// hashes: any edit to a definition invalidates the cached data, including
// edits the queries don't depend on. Over-invalidation just costs a re-query;
// silently reusing data computed from an older definition skews the power
// estimates without any signal to the user.
function getPopulationSourceSettingsHash({
  datasource,
  sourceType,
  sourceId,
  userIdType,
  segment,
  factTable,
}: {
  datasource: DataSourceInterface;
  sourceType: CreatePopulationDataProps["sourceType"];
  sourceId: string;
  userIdType: string;
  segment: SegmentInterface | null;
  factTable: FactTableInterface | null;
}): string {
  return hashObject({
    datasourceId: datasource.id,
    // Covers exposure/identity-join settings used to join id types
    datasourceDateUpdated: datasource.dateUpdated ?? null,
    sourceType,
    sourceId,
    userIdType,
    segmentDateUpdated: segment?.dateUpdated ?? null,
    factTableDateUpdated: factTable?.dateUpdated ?? null,
  });
}

function getPopulationMetricSettingsHash(
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
): string {
  // Fact table edits (sql, filters) don't bump the metric's own dateUpdated
  const factTableStamps: { id: string; dateUpdated: Date | null }[] = [];
  if (isFactMetric(metric)) {
    [metric.numerator.factTableId, metric.denominator?.factTableId].forEach(
      (factTableId) => {
        if (!factTableId) return;
        factTableStamps.push({
          id: factTableId,
          dateUpdated: factTableMap.get(factTableId)?.dateUpdated ?? null,
        });
      },
    );
  }
  return hashObject({
    id: metric.id,
    dateUpdated: metric.dateUpdated ?? null,
    factTables: factTableStamps,
  });
}

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

  const metricMap = await getMetricMap(context);
  const factTableMap = await getFactTableMap(context);

  const segment =
    data.sourceType === "segment"
      ? await context.models.segments.getById(data.sourceId)
      : null;
  const sourceFactTable =
    data.sourceType === "factTable"
      ? (factTableMap.get(data.sourceId) ?? null)
      : null;

  const sourceSettingsHash = getPopulationSourceSettingsHash({
    datasource: integration.datasource,
    sourceType: data.sourceType,
    sourceId: data.sourceId,
    userIdType: data.userIdType,
    segment,
    factTable: sourceFactTable,
  });

  const metricSettingsHashes: Record<string, string> = {};
  data.metricIds.forEach((metricId) => {
    const metric = metricMap.get(metricId);
    if (metric) {
      metricSettingsHashes[metricId] = getPopulationMetricSettingsHash(
        metric,
        factTableMap,
      );
    }
  });

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

  // TODO incrementally update metrics
  if (
    !data.force &&
    populationData &&
    populationData.datasourceId === data.datasourceId &&
    // The population (units) side must have been computed from the same
    // datasource/segment/fact table definitions. Documents written before
    // hashes existed have no sourceSettingsHash and are treated as stale.
    populationData.sourceSettingsHash === sourceSettingsHash
  ) {
    // Only reuse a cached metric if it was computed from the current metric
    // definition; re-query metrics whose definition changed since.
    const cachedValidMetricIds = new Set(
      populationData.metrics
        .filter((m) => {
          const storedHash = populationData.metricSettingsHashes?.[m.metricId];
          return (
            storedHash !== undefined &&
            storedHash === metricSettingsHashes[m.metricId]
          );
        })
        .map((m) => m.metricId),
    );
    // only ask for new or stale metrics
    snapshotSettings.goalMetrics = data.metricIds.filter(
      (m) => !cachedValidMetricIds.has(m),
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

    sourceSettingsHash,
    // Only the metrics this document will actually contain data for
    metricSettingsHashes: Object.fromEntries(
      snapshotSettings.goalMetrics
        .filter((metricId) => metricSettingsHashes[metricId] !== undefined)
        .map((metricId) => [metricId, metricSettingsHashes[metricId]]),
    ),

    units: [],
    metrics: [],
  });
  const queryRunner = new PopulationDataQueryRunner(
    context,
    model,
    integration,
    true,
  );

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
