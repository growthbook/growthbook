import { analyzeExperimentPower } from "shared/enterprise";
import { addDays } from "date-fns";
import {
  expandMetricGroups,
  ExperimentMetricInterface,
  getAllMetricIdsFromExperiment,
  isFactMetric,
  isRatioMetric,
  quantileMetricType,
} from "shared/experiments";
import { FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS } from "shared/constants";
import { date, daysBetween } from "shared/dates";
import chunk from "lodash/chunk";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { MetricInterface } from "back-end/types/metric";
import { Queries, QueryPointer, QueryStatus } from "back-end/types/query";
import { SegmentInterface } from "back-end/types/segment";
import {
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { parseDimensionId } from "back-end/src/services/experiments";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  ExperimentFactMetricsQueryParams,
  ExperimentMetricQueryParams,
  ExperimentMetricStats,
  ExperimentQueryResponses,
  ExperimentResults,
  ExperimentUnitsQueryParams,
  SourceIntegrationInterface,
} from "back-end/src/types/Integration";
import { expandDenominatorMetrics } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { OrganizationInterface } from "back-end/types/organization";
import { FactMetricInterface } from "back-end/types/fact-table";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { updateReport } from "back-end/src/models/ReportModel";
import { BanditResult } from "back-end/types/experiment";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { 
  SnapshotResult, 
  TRAFFIC_QUERY_NAME,
  getFactMetricGroups
} from "./ExperimentResultsQueryRunner";

export const INCREMENTAL_UNITS_TABLE_PREFIX = "growthbook_units";
export const INCREMENTAL_METRICS_TABLE_PREFIX = "growthbook_metrics";
export const INCREMENTAL_CUPED_TABLE_PREFIX = "growthbook_cuped";

export type ExperimentIncrementalRefreshQueryParams = {
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
  recreateUnitsTable: boolean;
};

export const startExperimentIncrementalRefreshQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {

  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasIncrementalRefreshFeature = orgHasPremiumFeature(org, "incremental-refresh");

  const activationMetric = snapshotSettings.activationMetric
    ? metricMap.get(snapshotSettings.activationMetric) ?? null
    : null;


  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment
    );
  }

  const settings = integration.datasource.settings;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId
  );

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const allMetricGroups = await context.models.metricGroups.getAll();
  const selectedMetrics = expandMetricGroups(
    getAllMetricIdsFromExperiment(snapshotSettings, false),
    allMetricGroups
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }
  
  // TODO Metric updates
  // TODO health query
  // TODO validate that incremental refresh is enabled

  const canRunIncrementalRefreshQueries = 
    hasIncrementalRefreshFeature &&
    settings.incrementalRefresh?.enabled;

  const queries: Queries = [];

  if (
    !canRunIncrementalRefreshQueries
  ) {
    throw new Error("Integration does not support incremental refresh queries");
  }

  const unitsTableFullName = integration.generateTablePath && integration.generateTablePath(
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${queryParentId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true
    )
  ;

  if (!unitsTableFullName) {
    throw new Error("Unable to generate table; table path generator not specified.");
  }

  // queries to run
  let createUnitsTableQuery: QueryPointer | null = null;
  if (params.recreateUnitsTable) {
    const dropOldUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}_old`,
      query: integration.getDropOldIncrementalUnitsQuery({
        unitsTableFullName: unitsTableFullName,
      }),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runDropTableQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshDropUnitsTable",
    });
    queries.push(dropOldUnitsTableQuery);

    createUnitsTableQuery = await startQuery({
      name: `create_${queryParentId}`,
      query: integration.getCreateExperimentIncrementalUnitsQuery({
        unitsTableFullName: unitsTableFullName,
        settings: snapshotSettings,
        activationMetric: activationMetric,
        dimensions: [], // TODO experiment dimensions
      }),
      dependencies: [dropOldUnitsTableQuery.query],
      run: (query, setExternalId) => integration.runIncrementalWithNoOutputQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentIncrementalRefreshCreateUnitsTable",
    });
    queries.push(createUnitsTableQuery);
  }

  // TODO get from model
  const lastMaxTimestamp = params.recreateUnitsTable ? snapshotSettings.startDate : new Date();
  const updateUnitsTableQuery = await startQuery({
    name: `update_${queryParentId}`,
    query: integration.getUpdateExperimentIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
      settings: snapshotSettings,
      activationMetric: activationMetric,
      dimensions: [], // TODO experiment dimensions
      lastMaxTimestamp: lastMaxTimestamp,
    }),
    dependencies: createUnitsTableQuery ? [createUnitsTableQuery.query] : [],
    run: (query, setExternalId) => integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentIncrementalRefreshUpdateUnitsTable",
  });
  queries.push(updateUnitsTableQuery);

  const dropUnitsTableQuery = await startQuery({
    name: `drop_${queryParentId}`,
    query: integration.getDropOldIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
    }),
    run: (query, setExternalId) => integration.runDropTableQuery(query, setExternalId),
    dependencies: [updateUnitsTableQuery.query],
    process: (rows) => rows,
    queryType: "experimentIncrementalRefreshDropUnitsTable",
  });
  queries.push(dropUnitsTableQuery);

  const alterUnitsTableQuery = await startQuery({
    name: `alter_${queryParentId}`,
    query: integration.getAlterNewIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
    }),
    dependencies: [dropUnitsTableQuery.query],
    run: (query, setExternalId) => integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => rows,
    queryType: "experimentIncrementalRefreshAlterUnitsTable",
  });
  queries.push(alterUnitsTableQuery);


  const maxTimestampQuery = await startQuery({
    name: `max_timestamp_${queryParentId}`,
    query: integration.getMaxTimestampIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
    }),
    dependencies: [alterUnitsTableQuery.query],
    run: (query, setExternalId) => integration.runIncrementalWithNoOutputQuery(query, setExternalId),
    process: (rows) => {
      // TODO: is this the right place to do this
      // TODO can we type max_timestamp better?
      const maxTimestamp = new Date(rows[0].max_timestamp as string);
      if (maxTimestamp) {
        context.models.incrementalRefresh
          .upsertByExperimentId(snapshotSettings.experimentId, {
            unitsTableFullName: unitsTableFullName,
            lastScannedTimestamp: maxTimestamp,
          })
          .catch((e) => context.logger.error(e));
      }
      return rows;
    },
    queryType: "experimentIncrementalRefreshMaxTimestampUnitsTable",
  });
  queries.push(maxTimestampQuery);

  return queries;
};

export class ExperimentResultsQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentIncrementalRefreshQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource
    );
  }

  async startQueries(params: ExperimentIncrementalRefreshQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    
    if (!this.integration.getSourceProperties().hasIncrementalRefresh) {
      throw new Error("Integration does not support incremental refresh queries");
    }

    return startExperimentIncrementalRefreshQueries(
      this.context,
      params,
      this.integration,
      this.startQuery.bind(this)
    );
  }

  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    return {
      analyses: [],
      multipleExposures: 0,
      unknownVariations: [],
    };
    // const {
    //   results: analysesResults,
    //   banditResult,
    // } = await analyzeExperimentResults({
    //   queryData: queryMap,
    //   snapshotSettings: this.model.settings,
    //   analysisSettings: this.model.analyses.map((a) => a.settings),
    //   variationNames: this.variationNames,
    //   metricMap: this.metricMap,
    // });

    // const result: SnapshotResult = {
    //   analyses: this.model.analyses,
    //   multipleExposures: 0,
    //   unknownVariations: [],
    //   banditResult,
    // };

    // analysesResults.forEach((results, i) => {
    //   const analysis = this.model.analyses[i];
    //   if (!analysis) return;

    //   analysis.results = results.dimensions || [];
    //   analysis.status = "success";
    //   analysis.error = "";

    //   // TODO: do this once, not per analysis
    //   result.unknownVariations = results.unknownVariations || [];
    //   result.multipleExposures = results.multipleExposures ?? 0;
    // });

    // // Run health checks
    // const healthQuery = queryMap.get(TRAFFIC_QUERY_NAME);
    // if (healthQuery) {
    //   const rows = healthQuery.result as ExperimentAggregateUnitsQueryResponseRows;
    //   const trafficHealth = analyzeExperimentTraffic({
    //     rows: rows,
    //     error: healthQuery.error,
    //     variations: this.model.settings.variations,
    //   });

    //   result.health = {
    //     traffic: trafficHealth,
    //   };

    //   const relativeAnalysis = this.model.analyses.find(
    //     (a) => a.settings.differenceType === "relative"
    //   );

    //   const isEligibleForMidExperimentPowerAnalysis =
    //     relativeAnalysis &&
    //     this.model.settings.banditSettings === undefined &&
    //     rows &&
    //     rows.length;

    //   if (isEligibleForMidExperimentPowerAnalysis) {
    //     const today = new Date();
    //     const phaseStartDate = this.model.settings.startDate;
    //     const experimentMaxLengthDays = this.context.org.settings
    //       ?.experimentMaxLengthDays;

    //     const experimentTargetEndDate = addDays(
    //       phaseStartDate,
    //       experimentMaxLengthDays && experimentMaxLengthDays > 0
    //         ? experimentMaxLengthDays
    //         : FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS
    //     );
    //     const targetDaysRemaining = daysBetween(today, experimentTargetEndDate);
    //     // NB: This does not run a SQL query, but it is a health check that depends on the trafficHealth
    //     result.health.power = analyzeExperimentPower({
    //       trafficHealth,
    //       targetDaysRemaining,
    //       analysis: relativeAnalysis,
    //       goalMetrics: this.model.settings.goalMetrics,
    //       variationsSettings: this.model.settings.variations,
    //     });
    //   }
    // }

    // return result;
  }

  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.model.organization, this.model.id);
    if (!obj)
      throw new Error("Could not load snapshot model: " + this.model.id);
    return obj;
  }

  
  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date;
    result?: SnapshotResult;
    error?: string;
  }): Promise<ExperimentSnapshotInterface> {
    const updates: Partial<ExperimentSnapshotInterface> = {
      queries,
      runStarted,
      error,
      ...result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
          ? "error"
          : "success",
    };
    await updateSnapshot({
      organization: this.model.organization,
      id: this.model.id,
      updates,
      context: this.context,
    });
    if (
      this.model.report &&
      ["failed", "partially-succeeded", "succeeded"].includes(status)
    ) {
      await updateReport(this.model.organization, this.model.report, {
        snapshot: this.model.id,
      });
    }
    return {
      ...this.model,
      ...updates,
    };
  }
}
