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
import { daysBetween } from "shared/dates";
import chunk from "lodash/chunk";
import { isDefined } from "shared/util";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiReqContext } from "back-end/types/api";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotHealth,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricForSnapshot,
  SnapshotSettingsVariation,
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
  analyzeJointResults,
  analyzeMainResults,
  getMetricsAndQueryDataForStatsEngine,
} from "back-end/src/services/stats";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentDimension,
  ExperimentFactMetricsQueryParams,
  ExperimentFactMetricsQueryResponseRows,
  ExperimentJointUnitsQueryParams,
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
import { BanditResult, ExperimentInterface } from "back-end/types/experiment";
import {
  getFactMetricGroups,
  SnapshotResult,
  UNITS_TABLE_PREFIX,
} from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  InteractionSnapshotConfig,
  InteractionSnapshotInterface,
  InteractionSnapshotResult,
  UpdateInteractionSnapshotProps,
} from "back-end/types/interaction-snapshot";
import { DataSourceInterface } from "back-end/types/datasource";
import { getMetricForSnapshot } from "back-end/src/services/reports";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";

export type ExperimentInteractionQueryParams = {
  config: InteractionSnapshotConfig;
  datasourceId: string;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
};

export const startExperimentInteractionQueries = async (
  context: ApiReqContext,
  params: ExperimentInteractionQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const queryParentId = params.queryParentId;
  const metricMap = params.metricMap;

  const { org } = context;
  const hasPipelineModeFeature = orgHasPremiumFeature(org, "pipeline-mode");

  // Only include metrics tied to this experiment (both goal and guardrail metrics)
  const allMetricGroups = await context.models.metricGroups.getAll();
  const selectedMetrics = expandMetricGroups(
    getAllMetricIdsFromExperiment(params.config, false),
    allMetricGroups
  )
    .map((m) => metricMap.get(m))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  // per experiment
  // let segmentObj: SegmentInterface | null = null;
  // if (snapshotSettings.segment) {
  //   segmentObj = await context.models.segments.getById(
  //     snapshotSettings.segment
  //   );
  // }

  const settings = integration.datasource.settings;
  // No dimension support
  const queries: Queries = [];

  // Settings for units table
  const useUnitsTable =
    (integration.getSourceProperties().supportsWritingTables &&
      settings.pipelineSettings?.allowWriting &&
      !!settings.pipelineSettings?.writeDataset &&
      hasPipelineModeFeature) ??
    false;
  let unitQuery: QueryPointer | null = null;
  const unitsTableFullName =
    useUnitsTable && !!integration.generateTablePath
      ? integration.generateTablePath(
          `${UNITS_TABLE_PREFIX}_${queryParentId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true
        )
      : "";

  const experiment1SnapshotSettings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: params.config.experiment1Params.activationMetricId,
    defaultMetricPriorSettings: {
      // TODO
      mean: 0,
      stddev: 1,
      override: false,
      proper: true,
    },
    regressionAdjustmentEnabled: false, // TODO
    attributionModel: "experimentDuration", // TODO
    queryFilter: "", // TODO
    segment: "", // TODO
    skipPartialData: false, // TODO
    ...params.config,
    ...params.config.experiment1Params,
    experimentId: params.config.experiment1Params.trackingKey,
    datasourceId: params.datasourceId,
  };
  const experiment2SnapshotSettings: ExperimentSnapshotSettings = {
    ...experiment1SnapshotSettings,
    ...params.config.experiment2Params,
    experimentId: params.config.experiment2Params.trackingKey,
  };

  const experiment1ActivationMetric = experiment1SnapshotSettings.activationMetric
    ? metricMap.get(experiment1SnapshotSettings.activationMetric) ?? null
    : null;
  const experiment2ActivationMetric = experiment2SnapshotSettings.activationMetric
    ? metricMap.get(experiment2SnapshotSettings.activationMetric) ?? null
    : null;

  const jointUnitQueryParams: ExperimentJointUnitsQueryParams = {
    experiment1Params: {
      settings: experiment1SnapshotSettings,
      includeIdJoins: true,
      ctePrefix: "e1",
      activationMetric: experiment1ActivationMetric,
      factTableMap: params.factTableMap,
      dimensions: [],
      segment: null,
    },
    experiment2Params: {
      settings: experiment2SnapshotSettings,
      includeIdJoins: true,
      ctePrefix: "e2",
      activationMetric: experiment2ActivationMetric,
      factTableMap: params.factTableMap,
      dimensions: [],
      segment: null,
    },
  };

  if (useUnitsTable) {
    // The Mixpanel integration does not support writing tables
    if (!integration.generateTablePath) {
      throw new Error(
        "Unable to generate table; table path generator not specified."
      );
    }
    if (
      !integration.getJointExperimentUnitsQuery ||
      !integration.runJointExperimentUnitsQuery
    ) {
      throw new Error(
        "Integration does not support joint experiment units queries"
      );
    }
    unitQuery = await startQuery({
      name: queryParentId,
      query: integration.getJointExperimentUnitsQuery(jointUnitQueryParams),
      dependencies: [],
      run: (query, setExternalId) =>
        integration.runJointExperimentUnitsQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentUnits",
    });
    queries.push(unitQuery);
  }

  const { groups, singles } = getFactMetricGroups(
    selectedMetrics,
    { skipPartialData: false }, // TODO
    integration,
    org
  );

  for (const m of singles) {
    const denominatorMetrics: MetricInterface[] = [];
    if (!isFactMetric(m) && m.denominator) {
      denominatorMetrics.push(
        ...expandDenominatorMetrics(
          m.denominator,
          metricMap as Map<string, MetricInterface>
        )
          .map((m) => metricMap.get(m) as MetricInterface)
          .filter(Boolean)
      );
    }
    const queryParams: ExperimentMetricQueryParams = {
      activationMetric: experiment1ActivationMetric, // TODO
      denominatorMetrics,
      dimensions: [],
      metric: m,
      segment: null,
      settings: experiment1SnapshotSettings, // TODO
      unitsSource: "otherQuery",
      unitsSql: integration.getJointExperimentUnitsQuery(jointUnitQueryParams),
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };
    queries.push(
      await startQuery({
        name: m.id,
        query: integration.getExperimentMetricQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          integration.runExperimentMetricQuery(query, setExternalId),
        process: (rows) => rows,
        queryType: "experimentMetric",
      })
    );
  }

  for (const [i, m] of groups.entries()) {
    const queryParams: ExperimentFactMetricsQueryParams = {
      activationMetric: experiment1ActivationMetric, // TODO
      dimensions: [], // TODO
      metrics: m,
      segment: null, // TODO
      settings: experiment1SnapshotSettings, // TODO
      unitsSource: "otherQuery",
      unitsSql: integration.getJointExperimentUnitsQuery(jointUnitQueryParams),
      unitsTableFullName: unitsTableFullName,
      factTableMap: params.factTableMap,
    };

    if (
      !integration.getExperimentFactMetricsQuery ||
      !integration.runExperimentFactMetricsQuery
    ) {
      throw new Error("Integration does not support multi-metric queries");
    }

    queries.push(
      await startQuery({
        name: `group_${i}`,
        query: integration.getExperimentFactMetricsQuery(queryParams),
        dependencies: unitQuery ? [unitQuery.query] : [],
        run: (query, setExternalId) =>
          (integration as SqlIntegration).runExperimentFactMetricsQuery(
            query,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "experimentMultiMetric",
      })
    );
  }

  const dropUnitsTable =
    integration.getSourceProperties().dropUnitsTable &&
    settings.pipelineSettings?.unitsTableDeletion;
  if (useUnitsTable && dropUnitsTable) {
    const dropUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}`,
      query: integration.getDropUnitsTableQuery({
        fullTablePath: unitsTableFullName,
      }),
      dependencies: [],
      // all other queries in model must succeed or fail first
      runAtEnd: true,
      run: (query, setExternalId) =>
        integration.runDropTableQuery(query, setExternalId),
      process: (rows) => rows,
      queryType: "experimentDropUnitsTable",
    });
    queries.push(dropUnitsTableQuery);
  }

  return queries;
};

export class ExperimentInteractionQueryRunner extends QueryRunner<
  InteractionSnapshotInterface,
  ExperimentInteractionQueryParams,
  InteractionSnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource
    );
  }
  async startQueries(
    params: ExperimentInteractionQueryParams
  ): Promise<Queries> {
    this.metricMap = params.metricMap;
    // TODO Why is variation Names different here, needs to be IDs
    this.variationNames = params.variationNames;

    if (
      this.integration.getSourceProperties().separateExperimentResultQueries
    ) {
      return startExperimentInteractionQueries(
        this.context,
        params,
        this.integration,
        this.startQuery.bind(this)
      );
    } else {
      throw new Error("Experiment interaction queries are not supported");
    }
  }

  async runAnalysis(queryMap: QueryMap): Promise<InteractionSnapshotResult> {
    console.log("HERE")
    const experiment1 = await getExperimentById(
      this.context,
      this.model.experimentId1
    );
    const experiment2 = await getExperimentById(
      this.context,
      this.model.experimentId2
    );

    if (!experiment1 || !experiment2) {
      throw new Error("Experiment not found");
    }

    const snapshotSettings = getExperimentSnapshotSettingsFromInteractionConfig(
      {
        config: this.model.config,
        datasource: this.integration.datasource,
        experiment1,
        experiment2,
      }
    );

    const {
      results: analysesResults,
    } = await analyzeExperimentResults({
      queryData: queryMap,
      snapshotSettings,
      analysisSettings: this.model.jointAnalyses.map((a) => a.settings),
      variationNames: this.variationNames,
      metricMap: this.metricMap,
    });

    const { results: mainResultsExp1 } = await analyzeMainResults({
      queryData: queryMap,
      snapshotSettings,
      analysisSettings: this.model.mainAnalyses.map((a) => a.settings),
      variationNames: this.variationNames,
      experimentNumber: 1,
      metricMap: this.metricMap,
    });
    const { results: mainResultsExp2 } = await analyzeMainResults({
      queryData: queryMap,
      snapshotSettings,
      analysisSettings: this.model.mainAnalyses.map((a) => a.settings),
      variationNames: this.variationNames,
      experimentNumber: 2,
      metricMap: this.metricMap,
    });

    const result: InteractionSnapshotResult = {
      jointAnalyses: this.model.jointAnalyses,
      mainAnalyses: this.model.mainAnalyses,
      multipleExposures: 0,
      unknownVariations: [],
    };

    analysesResults.forEach((results, i) => {
      const analysis = this.model.jointAnalyses[i];
      if (!analysis) return;

      analysis.results = results.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = results.unknownVariations || [];
      result.multipleExposures = results.multipleExposures ?? 0;
    });

    if (mainResultsExp1 && mainResultsExp2) {
      const analysis = result.mainAnalyses[0];
      const mainResult1 = mainResultsExp1[0];
      if (analysis) {
        analysis.results = mainResult1.dimensions || [];
        analysis.status = "success";
        analysis.error = "";
      }
    }
    if (mainResultsExp2) {
      const analysis = result.mainAnalyses[1];
      const mainResult2 = mainResultsExp2[0];
      if (analysis) {
        analysis.results = mainResult2.dimensions || [];
        analysis.status = "success";
        analysis.error = "";
      }
    }

    return result;
  }

  async getLatestModel(): Promise<InteractionSnapshotInterface> {
    const obj = await this.context.models.interactionSnapshots.getById(
      this.model.id
    );
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
    result?: InteractionSnapshotResult;
    error?: string;
  }): Promise<InteractionSnapshotInterface> {
    const updates: UpdateInteractionSnapshotProps = {
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
    const latest = await this.getLatestModel();
    const updated = await this.context.models.interactionSnapshots.update(
      latest,
      updates
    );
    return updated;
  }
}

function getExperimentSnapshotSettingsFromInteractionConfig({
  config,
  datasource,
  experiment1,
  experiment2,
}: {
  config: InteractionSnapshotConfig;
  datasource: DataSourceInterface;
  experiment1: ExperimentInterface;
  experiment2: ExperimentInterface;
}): ExperimentSnapshotSettings {
  const variationNames: string[] = [];
  const e1Ids = [
    ...experiment1.variations.map((v) => v.key),
    "__GBNULLVARIATION__",
  ];
  const e2Ids = [
    ...experiment2.variations.map((v) => v.key),
    "__GBNULLVARIATION__",
  ];

  e1Ids.forEach((v1) => {
    e2Ids.forEach((v2) => {
      variationNames.push(`${v1}___GBINTERACTION___${v2}`);
    });
  });

  const latestPhase1 = experiment1.phases[experiment1.phases.length - 1];
  const latestPhase2 = experiment2.phases[experiment2.phases.length - 1];
  const startDate =
    latestPhase1.dateStarted < latestPhase2.dateStarted
      ? latestPhase1.dateStarted
      : latestPhase2.dateStarted;
  const endDate =
    !latestPhase1.dateEnded ||
    (latestPhase2.dateEnded && latestPhase1.dateEnded > latestPhase2.dateEnded)
      ? latestPhase1.dateEnded
      : latestPhase2.dateEnded;
  const experimentSnapshotSettings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: experiment1.activationMetric || null, //TODO
    defaultMetricPriorSettings: {
      // TODO
      mean: 0,
      stddev: 1,
      override: false,
      proper: true,
    },
    regressionAdjustmentEnabled: false, // TODO
    attributionModel: "experimentDuration", // TODO
    queryFilter: "", // TODO
    segment: "", // TODO
    skipPartialData: false, // TODO
    metricSettings: config.metricSettings,
    goalMetrics: config.goalMetrics,
    exposureQueryId: experiment1.exposureQueryId,
    // TODOs
    experimentId: experiment1.id,
    // TODO
    variations: variationNames.map((v, i) => ({
      id: v,
      weight: 0.1, // TODO
    })),
    datasourceId: datasource.id,
    startDate: startDate,
    endDate: endDate || new Date(),
  };

  return experimentSnapshotSettings;
}
