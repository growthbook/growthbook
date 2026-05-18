import { tabulateCovariateImbalance } from "shared/health";
import {
  ExperimentMetricInterface,
  isFactMetric,
  isRatioMetric,
  isRegressionAdjusted,
  quantileMetricType,
} from "shared/experiments";
import cloneDeep from "lodash/cloneDeep";
import { SegmentInterface } from "shared/types/segment";
import {
  INCREMENTAL_REFRESH_METRIC_SOURCES_VERSION,
  IncrementalRefreshInterface,
  IncrementalRefreshMetricCovariateSourceInterface,
  IncrementalRefreshMetricRole,
  IncrementalRefreshMetricSourceInterface,
} from "shared/validators";
import {
  ExperimentAggregateUnitsQueryResponseRows,
  InsertMetricSourceDataQueryParams,
  MetricSourceMetricEntry,
  UpdateExperimentIncrementalUnitsQueryParams,
} from "shared/types/integrations";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import {
  ExperimentQueryMetadata,
  Queries,
  QueryPointer,
  QueryStatus,
} from "shared/types/query";
import { FactMetricInterface } from "shared/types/fact-table";
import { ApiReqContext } from "back-end/types/api";
import {
  findSnapshotById,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { updateReport } from "back-end/src/models/ReportModel";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import {
  getExperimentSettingsHashForIncrementalRefresh,
  getMetricSettingsHashForIncrementalRefresh,
} from "back-end/src/services/experimentTimeSeries";
import { validateIncrementalPipeline } from "back-end/src/services/dataPipeline";
import { getExposureQueryEligibleDimensions } from "back-end/src/services/dimensions";
import {
  chunkMetricsByRole,
  MetricWithRole,
} from "back-end/src/services/experimentQueries/experimentQueries";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { applyMetricOverrides } from "back-end/src/util/integration";
import {
  SnapshotResult,
  TRAFFIC_QUERY_NAME,
} from "./ExperimentResultsQueryRunner";
import {
  QueryRunner,
  QueryMap,
  ProcessedRowsType,
  RowsType,
  StartQueryParams,
} from "./QueryRunner";
import { shouldRunHealthTrafficQuery } from "./snapshotQueryHelpers";

export const INCREMENTAL_UNITS_TABLE_PREFIX = "gb_units";
export const INCREMENTAL_METRICS_TABLE_PREFIX = "gb_metrics";
export const INCREMENTAL_CUPED_TABLE_PREFIX = "gb_cuped";

export type ExperimentIncrementalRefreshQueryParams = {
  snapshotType: SnapshotType;
  snapshotSettings: ExperimentSnapshotSettings;
  variationNames: string[];
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  queryParentId: string;
  experimentId: string;
  experimentQueryMetadata: ExperimentQueryMetadata | null;
  // Incremental Refresh specific
  fullRefresh: boolean;
  incrementalRefreshStartTime: Date;
};

// TODO(incremental-refresh): add metrics to existing metric source to force recreating the whole thing.
// UI side to let the user know a refresh will trigger restating the whole metric source.
export interface MetricSourceGroups {
  groupId: string;
  factTableId: string;
  metrics: MetricSourceMetricEntry[];
}

// Returns true if the metric is a ratio metric whose numerator and denominator
// live in different fact tables. These metrics participate in two metric
// sources (one per fact table) and are stitched back together by a dedicated
// cross-fact-table stats query.
export function isCrossFtRatioMetric(metric: FactMetricInterface): boolean {
  return (
    isRatioMetric(metric) &&
    !!metric.denominator?.factTableId &&
    metric.denominator.factTableId !== metric.numerator.factTableId
  );
}

// Returns the unordered pair key for a cross-FT ratio metric so that metrics
// in either numerator/denominator orientation share a stats query.
export function getCrossFtPairKey(metric: FactMetricInterface): string | null {
  if (!isCrossFtRatioMetric(metric)) return null;
  const fts = [
    metric.numerator.factTableId,
    metric.denominator?.factTableId ?? "",
  ].sort();
  return `${fts[0]}__${fts[1]}`;
}

// Returns the sorted pair of fact table ids for a cross-FT ratio metric in a
// deterministic order so alias assignment is stable across runs.
export function getCrossFtPairFactTableIds(
  metric: FactMetricInterface,
): [string, string] | null {
  if (!isCrossFtRatioMetric(metric)) return null;
  const denomFt = metric.denominator?.factTableId ?? "";
  const fts = [metric.numerator.factTableId, denomFt].sort();
  return [fts[0], fts[1]];
}

export function getIncrementalRefreshMetricSources({
  metrics,
  existingMetricSources,
  integration,
  snapshotSettings,
}: {
  metrics: FactMetricInterface[];
  existingMetricSources: IncrementalRefreshInterface["metricSources"];
  integration: SourceIntegrationInterface;
  snapshotSettings: ExperimentSnapshotSettings;
}): MetricSourceGroups[] {
  // TODO(incremental-refresh): skip partial data is currently ignored
  // TODO(incremental-refresh): error if no efficient percentiles
  // shouldn't be possible since we are unlikely to build incremental
  // refresh for mySQL
  const getMetricGroupKey = (factTableId: string, metric: FactMetricInterface) =>
    `${factTableId}${quantileMetricType(metric) ? "_qtile" : ""}`;

  // Find the existing source registration (groupId + role) for this metric
  // against a particular fact table, so we keep the cache table identity stable
  // across runs.
  const findExistingRegistration = (
    metricId: string,
    factTableId: string,
  ): { groupId: string; role: IncrementalRefreshMetricRole } | null => {
    for (const group of existingMetricSources) {
      if (group.factTableId !== factTableId) continue;
      const match = group.metrics.find((m) => m.id === metricId);
      if (match) {
        return { groupId: group.groupId, role: match.role ?? "complete" };
      }
    }
    return null;
  };

  type GroupAccumulator = {
    groupId: string;
    factTableId: string;
    alreadyExists: boolean;
    entries: MetricSourceMetricEntry[];
  };
  const groups: Record<string, GroupAccumulator> = {};

  // Push a metric into a group with a particular role, preferring to reuse the
  // existing source registration (groupId) when one exists.
  const placeInGroup = (
    metric: FactMetricInterface,
    factTableId: string,
    role: IncrementalRefreshMetricRole,
  ) => {
    const existing = findExistingRegistration(metric.id, factTableId);
    const groupId = existing?.groupId ?? getMetricGroupKey(factTableId, metric);
    const alreadyExists = !!existing;
    const accum = (groups[groupId] = groups[groupId] || {
      groupId,
      factTableId,
      alreadyExists,
      entries: [],
    });
    // Keep alreadyExists true if any contributor was found in persisted state
    // so we don't re-create an existing cache table.
    accum.alreadyExists = accum.alreadyExists || alreadyExists;
    accum.entries.push({ metric, role });
  };

  metrics.forEach((metric) => {
    if (isCrossFtRatioMetric(metric) && metric.denominator?.factTableId) {
      placeInGroup(metric, metric.numerator.factTableId, "numerator");
      placeInGroup(metric, metric.denominator.factTableId, "denominator");
    } else {
      placeInGroup(metric, metric.numerator.factTableId, "complete");
    }
  });

  const finalGroups: MetricSourceGroups[] = [];
  Object.values(groups).forEach((group) => {
    if (group.alreadyExists) {
      finalGroups.push({
        groupId: group.groupId,
        factTableId: group.factTableId,
        metrics: group.entries,
      });
      return;
    }

    // For new groups, chunk by max columns per query using role-aware column
    // accounting so a cross-FT ratio metric only consumes the budget for the
    // side it actually contributes here.
    const withRegressionAdjusted: MetricWithRole[] = group.entries.map(
      (entry) => {
        const metric = cloneDeep(entry.metric);
        // TODO(overrides): refactor overrides to beginning of analysis
        applyMetricOverrides(metric, snapshotSettings);
        return {
          metric,
          regressionAdjusted:
            isRegressionAdjusted(metric) &&
            snapshotSettings.regressionAdjustmentEnabled,
          role: entry.role,
        };
      },
    );

    const chunks = chunkMetricsByRole({
      metrics: withRegressionAdjusted,
      maxColumnsPerQuery: integration.getSourceProperties().maxColumns,
      isBandit: !!snapshotSettings.banditSettings,
    });
    chunks.forEach((chunk, i) => {
      const randomId = Math.random().toString(36).substring(2, 15);
      // Reconstruct entries from the original (non-cloned) metric references so
      // downstream consumers see the originals.
      const entriesById = new Map(
        group.entries.map((e) => [e.metric.id, e]),
      );
      finalGroups.push({
        groupId: group.groupId + "_" + randomId + i,
        factTableId: group.factTableId,
        metrics: chunk.map(
          (c) => entriesById.get(c.metric.id) ?? { metric: c.metric, role: c.role },
        ),
      });
    });
  });

  return finalGroups;
}

const startExperimentIncrementalRefreshQueries = async (
  context: ApiReqContext,
  params: ExperimentIncrementalRefreshQueryParams,
  integration: SourceIntegrationInterface,
  startQuery: (
    params: StartQueryParams<RowsType, ProcessedRowsType>,
  ) => Promise<QueryPointer>,
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;
  const experimentId = params.experimentId;
  const metricMap = params.metricMap;

  const { org } = context;

  const activationMetric = snapshotSettings.activationMetric
    ? (metricMap.get(snapshotSettings.activationMetric) ?? null)
    : null;

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await context.models.segments.getById(
      snapshotSettings.segment,
    );
  }

  const settings = integration.datasource.settings;

  // Only include metrics tied to this experiment, which is goverend by the snapshotSettings.metricSettings
  // after the introduction of metric slices
  // TODO(bryce): refactor the source of truth for metrics so that the expandedMetricMap isn't used to add
  // metrics to an experiment
  const selectedMetrics = snapshotSettings.metricSettings
    .map((m) => metricMap.get(m.id))
    .filter((m) => m) as ExperimentMetricInterface[];
  if (!selectedMetrics.length) {
    throw new Error("Experiment must have at least 1 metric selected.");
  }

  const queries: Queries = [];

  const unitsTableName = `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}`;
  const unitsTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      unitsTableName,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const randomId = Math.random().toString(36).substring(2, 10);
  const unitsTempTableFullName =
    integration.generateTablePath &&
    integration.generateTablePath(
      `${INCREMENTAL_UNITS_TABLE_PREFIX}_${experimentId}_temp_${randomId}`,
      settings.pipelineSettings?.writeDataset,
      settings.pipelineSettings?.writeDatabase,
      true,
    );
  if (!unitsTempTableFullName) {
    throw new Error(
      "Unable to generate table; table path generator not specified.",
    );
  }

  const rawIncrementalRefreshModel = params.fullRefresh
    ? null
    : await context.models.incrementalRefresh.getByExperimentId(experimentId);

  // If the persisted model was written by an older code version that used a
  // different metricSources shape (e.g., the pre-v2 shape that gave cross-FT
  // ratio metrics their own dedicated source group), treat this run as a full
  // refresh so stale cache tables are rebuilt from scratch.
  const metricSourcesVersionMismatch =
    rawIncrementalRefreshModel !== null &&
    (rawIncrementalRefreshModel.metricSourcesVersion ?? 1) <
      INCREMENTAL_REFRESH_METRIC_SOURCES_VERSION;

  const incrementalRefreshModel = metricSourcesVersionMismatch
    ? null
    : rawIncrementalRefreshModel;

  const executionId = params.queryParentId;

  // Each cache table (= one per (factTableId, isQuantile) source) is identified
  // by its source's factTableId. A metric's contribution to a source is tagged
  // with a role:
  //   - "complete" for same-fact-table metrics
  //   - "numerator" / "denominator" for cross-fact-table ratio metrics
  // A source must be re-created when any contributing (metric, role) tuple in
  // its FT either is new vs. the persisted source or has changed role since
  // last run (e.g., a ratio flipping from same-FT to cross-FT removes the
  // "denominator" side from FT_A and adds it on FT_B).
  //
  // We allow removed metrics without re-creating: their column simply stops
  // getting populated. New columns require a schema change, hence a re-create.
  const desiredRolesByFt = new Map<
    string,
    Map<string, IncrementalRefreshMetricRole>
  >();
  const setDesiredRole = (
    ft: string,
    metricId: string,
    role: IncrementalRefreshMetricRole,
  ) => {
    if (!desiredRolesByFt.has(ft)) desiredRolesByFt.set(ft, new Map());
    desiredRolesByFt.get(ft)?.set(metricId, role);
  };
  selectedMetrics.filter(isFactMetric).forEach((m) => {
    if (!isFactMetric(m)) return;
    if (isCrossFtRatioMetric(m) && m.denominator?.factTableId) {
      setDesiredRole(m.numerator.factTableId, m.id, "numerator");
      setDesiredRole(m.denominator.factTableId, m.id, "denominator");
    } else {
      setDesiredRole(m.numerator.factTableId, m.id, "complete");
    }
  });

  // Group ids of sources that must be re-created because at least one
  // (metric, role) tuple desired for this FT is missing or differs from the
  // persisted record. Used below to drop the corresponding existingSources
  // entries so the standard "no existing source" path re-creates the table.
  const sourceGroupIdsToRecreate = new Set<string>();

  if (incrementalRefreshModel && incrementalRefreshModel.metricSources.length) {
    // Validate all selected metrics are fact metrics — incremental refresh
    // only supports fact metrics today.
    for (const m of selectedMetrics) {
      if (!isFactMetric(m)) {
        throw new Error(
          "Only fact metrics are supported with incremental refresh.",
        );
      }
    }

    incrementalRefreshModel.metricSources.forEach((source) => {
      const desired = desiredRolesByFt.get(source.factTableId) ?? new Map();
      const storedRoles = new Map<string, IncrementalRefreshMetricRole>(
        source.metrics.map((m) => [m.id, m.role ?? "complete"]),
      );

      for (const [metricId, desiredRole] of desired) {
        if (storedRoles.get(metricId) !== desiredRole) {
          sourceGroupIdsToRecreate.add(source.groupId);
          break;
        }
      }
    });
  }

  // Begin Queries
  const lastMaxTimestamp = incrementalRefreshModel?.unitsMaxTimestamp;

  const exposureQuery = (settings?.queries?.exposure || []).find(
    (q) => q.id === snapshotSettings.exposureQueryId,
  );

  if (!exposureQuery) {
    throw new Error("Exposure query not found");
  }

  const {
    eligibleDimensions,
    // Used for traffic analysis
    eligibleDimensionsWithSlices,
    // Used for pre-computing/post-stratification
    eligibleDimensionsWithSlicesUnderMaxCells,
  } = getExposureQueryEligibleDimensions({
    exposureQuery,
    incrementalRefreshModel,
    nVariations: params.variationNames.length,
  });

  const unitQueryParams: UpdateExperimentIncrementalUnitsQueryParams = {
    unitsTableFullName: unitsTableFullName,
    unitsTempTableFullName: unitsTempTableFullName,
    settings: snapshotSettings,
    activationMetric: null, // TODO(incremental-refresh): activation metric
    dimensions: eligibleDimensions,
    segment: segmentObj,
    incrementalRefreshStartTime: params.incrementalRefreshStartTime,
    factTableMap: params.factTableMap,
    lastMaxTimestamp: lastMaxTimestamp || null,
  };

  let createUnitsTableQuery: QueryPointer | null = null;
  if (params.fullRefresh) {
    const dropOldUnitsTableQuery = await startQuery({
      name: `drop_${queryParentId}_old`,
      query: integration.getDropOldIncrementalUnitsQuery({
        unitsTableFullName: unitQueryParams.unitsTableFullName,
      }),
      dependencies: [],
      run: (query, setExternalId, queryMetadata) =>
        integration.runDropTableQuery(query, setExternalId, queryMetadata),
      queryType: "experimentIncrementalRefreshDropUnitsTable",
    });
    queries.push(dropOldUnitsTableQuery);

    createUnitsTableQuery = await startQuery({
      name: `create_${queryParentId}`,
      displayTitle: "Create Experiment Units Table",
      query:
        integration.getCreateExperimentIncrementalUnitsQuery(unitQueryParams),
      dependencies: [dropOldUnitsTableQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshCreateUnitsTable",
    });
    queries.push(createUnitsTableQuery);
  }

  const updateUnitsTableQuery = await startQuery({
    name: `update_${queryParentId}`,
    displayTitle: "Update Experiment Units Table",
    query:
      integration.getUpdateExperimentIncrementalUnitsQuery(unitQueryParams),
    dependencies: [
      ...(createUnitsTableQuery ? [createUnitsTableQuery.query] : []),
    ],
    run: (query, setExternalId, queryMetadata) =>
      integration.runIncrementalWithNoOutputQuery(
        query,
        setExternalId,
        queryMetadata,
      ),
    queryType: "experimentIncrementalRefreshUpdateUnitsTable",
  });
  queries.push(updateUnitsTableQuery);

  const dropUnitsTableQuery = await startQuery({
    name: `drop_${queryParentId}`,
    displayTitle: "Drop Old Experiment Units Table",
    query: integration.getDropOldIncrementalUnitsQuery({
      unitsTableFullName: unitsTableFullName,
    }),
    run: (query, setExternalId, queryMetadata) =>
      integration.runDropTableQuery(query, setExternalId, queryMetadata),
    dependencies: [updateUnitsTableQuery.query],
    queryType: "experimentIncrementalRefreshDropUnitsTable",
  });
  queries.push(dropUnitsTableQuery);

  const alterUnitsTableQuery = await startQuery({
    name: `alter_${queryParentId}`,
    displayTitle: "Rename Experiment Units Table",
    query: integration.getAlterNewIncrementalUnitsQuery({
      unitsTableName: unitsTableName,
      unitsTempTableFullName: unitsTempTableFullName,
    }),
    dependencies: [dropUnitsTableQuery.query],
    run: (query, setExternalId, queryMetadata) =>
      integration.runIncrementalWithNoOutputQuery(
        query,
        setExternalId,
        queryMetadata,
      ),
    queryType: "experimentIncrementalRefreshAlterUnitsTable",
  });
  queries.push(alterUnitsTableQuery);

  const maxTimestampUnitsTableQuery = await startQuery({
    name: `max_timestamp_${queryParentId}`,
    displayTitle: "Find Latest Experiment Source Timestamp",
    query: integration.getMaxTimestampIncrementalUnitsQuery({
      unitsTableFullName,
      lastMaxTimestamp: lastMaxTimestamp || null,
    }),
    dependencies: [alterUnitsTableQuery.query],
    run: (query, setExternalId, queryMetadata) =>
      integration.runIncrementalWithNoOutputQuery(
        query,
        setExternalId,
        queryMetadata,
      ),
    onSuccess: async (rows) => {
      const maxTimestamp = new Date(rows[0].max_timestamp as string);

      if (maxTimestamp) {
        const lockHeld =
          await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
            experimentId,
            executionId,
            {
              unitsTableFullName: unitsTableFullName,
              unitsMaxTimestamp: maxTimestamp,
              experimentSettingsHash:
                getExperimentSettingsHashForIncrementalRefresh(
                  snapshotSettings,
                ),
              unitsDimensions: eligibleDimensions.map((d) => d.id),
            },
          );
        if (lockHeld !== true) {
          context.logger.warn(
            "Incremental refresh execution lock lost for experiment: " +
              experimentId,
          );
        }
      }
    },
    queryType: "experimentIncrementalRefreshMaxTimestampUnitsTable",
  });
  queries.push(maxTimestampUnitsTableQuery);

  // Metric Queries

  // Full refresh will have a null incremental refresh model
  // Will recreate sources with new random id for metric sources
  let existingSources = incrementalRefreshModel?.metricSources ?? [];
  let existingCovariateSources =
    incrementalRefreshModel?.metricCovariateSources ?? [];

  // Drop existing sources flagged for re-creation by the (factTableId, role)
  // diff above so the standard "no existing source" path below rebuilds them
  // (and their CUPED covariate tables) from scratch.
  if (sourceGroupIdsToRecreate.size > 0) {
    existingSources = existingSources?.filter(
      (source) => !sourceGroupIdsToRecreate.has(source.groupId),
    );
    existingCovariateSources = existingCovariateSources?.filter(
      (source) => !sourceGroupIdsToRecreate.has(source.groupId),
    );
  }

  const metricSourceGroups = getIncrementalRefreshMetricSources({
    metrics: selectedMetrics.filter((m) => isFactMetric(m)),
    existingMetricSources: existingSources ?? [],
    integration,
    snapshotSettings,
  });
  let runningSourceData = existingSources ?? [];
  let runningCovariateSourceData = existingCovariateSources ?? [];

  // Pipeline pointers per fact table, used by the second pass (cross-FT stats
  // queries) to chain on each FT's insert query. Cross-FT ratio metrics never
  // gate a same-FT stats query; instead they fan out to a dedicated cross-FT
  // stats query per unordered fact-table pair.
  type SourcePipeline = {
    group: MetricSourceGroups;
    metricSourceTableFullName: string;
    insertMetricsSourceDataQuery: QueryPointer;
    metricParams: InsertMetricSourceDataQueryParams;
  };
  const sourcePipelinesByFt = new Map<string, SourcePipeline>();

  for (const group of metricSourceGroups) {
    const existingSource = existingSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const existingCovariateSource = existingCovariateSources?.find(
      (s) => s.groupId === group.groupId,
    );

    const metricSourceTableFullName: string | undefined =
      existingSource?.tableFullName ??
      (integration.generateTablePath &&
        integration.generateTablePath(
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${experimentId}_${group.groupId}`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));

    if (!metricSourceTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }

    const factTable = params.factTableMap.get(group.factTableId);

    // TODO(incremental-refresh): add metadata about source
    // in case same fact table is split across multiple sources
    const sourceName = factTable ? `(${factTable.name})` : "";

    let createMetricsSourceQuery: QueryPointer | null = null;
    if (!existingSource) {
      createMetricsSourceQuery = await startQuery({
        name: `create_metrics_source_${group.groupId}`,
        displayTitle: `Create Metrics Source ${sourceName}`,
        query: integration.getCreateMetricSourceTableQuery({
          settings: snapshotSettings,
          metrics: group.metrics,
          factTableMap: params.factTableMap,
          metricSourceTableFullName,
          factTableId: group.factTableId,
        }),
        dependencies: [updateUnitsTableQuery.query],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentIncrementalRefreshCreateMetricsSourceTable",
      });
      queries.push(createMetricsSourceQuery);
    }

    const metricParams: InsertMetricSourceDataQueryParams = {
      settings: snapshotSettings,
      activationMetric: activationMetric,
      factTableMap: params.factTableMap,
      metricSourceTableFullName,
      unitsSourceTableFullName: unitsTableFullName,
      metrics: group.metrics,
      lastMaxTimestamp: existingSource?.maxTimestamp || null,
      factTableId: group.factTableId,
    };

    const insertMetricsSourceDataQuery = await startQuery({
      name: `insert_metrics_source_data_${group.groupId}`,
      displayTitle: `Update Metrics Source ${sourceName}`,
      query: integration.getInsertMetricSourceDataQuery(metricParams),
      dependencies: [
        ...(createMetricsSourceQuery ? [createMetricsSourceQuery.query] : []),
        alterUnitsTableQuery.query,
      ],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalWithNoOutputQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
    });
    queries.push(insertMetricsSourceDataQuery);

    sourcePipelinesByFt.set(group.factTableId, {
      group,
      metricSourceTableFullName,
      insertMetricsSourceDataQuery,
      metricParams,
    });

    // CUPED tables — cross-FT ratio metrics are disallowed from CUPED today
    // (see validateIncrementalPipeline), so the only metrics that contribute
    // covariates here have role "complete" in this source.
    const sameFtMetricsForCovariates = group.metrics
      .filter((e) => e.role === "complete")
      .map((e) => e.metric);

    const metricSourceCovariateTableFullName: string | undefined =
      existingCovariateSource?.tableFullName ??
      (integration.generateTablePath &&
        integration.generateTablePath(
          `${INCREMENTAL_METRICS_TABLE_PREFIX}_${group.groupId}_covariate`,
          settings.pipelineSettings?.writeDataset,
          settings.pipelineSettings?.writeDatabase,
          true,
        ));
    if (!metricSourceCovariateTableFullName) {
      throw new Error(
        "Unable to generate table; table path generator not specified.",
      );
    }
    const anyMetricHasCuped = sameFtMetricsForCovariates.some((m) => {
      const metric = cloneDeep(m);
      applyMetricOverrides(metric, snapshotSettings);
      return (
        snapshotSettings.regressionAdjustmentEnabled &&
        isRegressionAdjusted(metric)
      );
    });
    let createMetricCovariateTableQuery: QueryPointer | null = null;
    let insertMetricCovariateDataQuery: QueryPointer | null = null;
    if (anyMetricHasCuped) {
      if (!existingCovariateSource) {
        // Safety net in case our data model is out of sync with the database
        const dropMetricCovariateTableQuery = await startQuery({
          name: `drop_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Drop Old Metric Covariate Table ${sourceName}`,
          query: integration.getDropMetricSourceCovariateTableQuery({
            metricSourceCovariateTableFullName,
          }),
          dependencies: [updateUnitsTableQuery.query],
          run: (query, setExternalId, queryMetadata) =>
            integration.runDropTableQuery(query, setExternalId, queryMetadata),
          queryType: "experimentIncrementalRefreshDropMetricsCovariateTable",
        });
        queries.push(dropMetricCovariateTableQuery);

        createMetricCovariateTableQuery = await startQuery({
          name: `create_metrics_covariate_table_${group.groupId}`,
          displayTitle: `Create Metric Covariate Table ${sourceName}`,
          query: integration.getCreateMetricSourceCovariateTableQuery({
            settings: snapshotSettings,
            metrics: sameFtMetricsForCovariates,
            metricSourceCovariateTableFullName,
          }),
          dependencies: [dropMetricCovariateTableQuery.query],
          run: (query, setExternalId, queryMetadata) =>
            integration.runIncrementalWithNoOutputQuery(
              query,
              setExternalId,
              queryMetadata,
            ),
          queryType: "experimentIncrementalRefreshCreateMetricsCovariateTable",
        });
        queries.push(createMetricCovariateTableQuery);
      }

      insertMetricCovariateDataQuery = await startQuery({
        name: `insert_metrics_covariate_data_${group.groupId}`,
        displayTitle: `Update Metric Covariate Data ${sourceName}`,
        query: integration.getInsertMetricSourceCovariateDataQuery({
          settings: snapshotSettings,
          activationMetric,
          factTableMap: params.factTableMap,
          metricSourceCovariateTableFullName,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: sameFtMetricsForCovariates,
          lastCovariateSuccessfulMaxTimestamp:
            existingCovariateSource?.lastSuccessfulMaxTimestamp || null,
        }),
        dependencies: [
          maxTimestampUnitsTableQuery.query,
          ...(createMetricCovariateTableQuery
            ? [createMetricCovariateTableQuery.query]
            : []),
        ],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalWithNoOutputQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        onSuccess: async () => {
          const incrementalRefresh =
            await context.models.incrementalRefresh.getByExperimentId(
              experimentId,
            );
          const lastSuccessfulMaxTimestamp =
            incrementalRefresh?.unitsMaxTimestamp ?? null;
          const updatedCovariateSource: IncrementalRefreshMetricCovariateSourceInterface =
            existingCovariateSource
              ? {
                  ...existingCovariateSource,
                  lastSuccessfulMaxTimestamp,
                }
              : {
                  groupId: group.groupId,
                  lastSuccessfulMaxTimestamp,
                  tableFullName: metricSourceCovariateTableFullName,
                };
          if (!existingCovariateSource) {
            runningCovariateSourceData = runningCovariateSourceData.concat(
              updatedCovariateSource,
            );
          } else {
            runningCovariateSourceData = runningCovariateSourceData.map((s) =>
              s.groupId === group.groupId ? updatedCovariateSource : s,
            );
          }
          const lockHeld =
            await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
              experimentId,
              executionId,
              {
                metricCovariateSources: runningCovariateSourceData,
              },
            );
          if (lockHeld !== true) {
            context.logger.warn(
              "Incremental refresh execution lock lost for experiment: " +
                experimentId,
            );
          }
        },
        queryType: "experimentIncrementalRefreshInsertMetricsCovariateData",
      });
      queries.push(insertMetricCovariateDataQuery);
    }

    const maxTimestampMetricsSourceQuery = await startQuery({
      name: `max_timestamp_metrics_source_${group.groupId}`,
      displayTitle: `Find Latest Metrics Source Timestamp ${sourceName}`,
      query: integration.getMaxTimestampMetricSourceQuery({
        metricSourceTableFullName,
        lastMaxTimestamp: existingSource?.maxTimestamp || null,
      }),
      dependencies: [insertMetricsSourceDataQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runMaxTimestampQuery(query, setExternalId, queryMetadata),
      onFailure: async () => {
        // Remove the source from the running data if max timestamp fails
        runningSourceData = runningSourceData.filter(
          (s) => s.groupId !== group.groupId,
        );
        // Note: onFailure is not awaited by QueryRunner, so we must catch
        // errors here to avoid unhandled promise rejections.
        context.models.incrementalRefresh
          .updateByExperimentIdIfCurrentExecution(experimentId, executionId, {
            metricSources: runningSourceData,
          })
          .catch((e) =>
            context.logger.error(
              e,
              "Failed to update metric sources on query failure",
            ),
          );
      },
      onSuccess: async (rows) => {
        const maxTimestamp = new Date(rows[0].max_timestamp as string);
        if (maxTimestamp) {
          // TODO(incremental-refresh): Clean up metadata handling in query runner
          const updatedSource: IncrementalRefreshMetricSourceInterface =
            existingSource
              ? {
                  ...existingSource,
                  maxTimestamp,
                }
              : {
                  groupId: group.groupId,
                  factTableId: group.factTableId,
                  maxTimestamp,
                  metrics: group.metrics.map((entry) => ({
                    id: entry.metric.id,
                    // TODO(incremental-refresh): set this elsewhere?
                    settingsHash: getMetricSettingsHashForIncrementalRefresh({
                      factMetric: entry.metric,
                      factTableMap: params.factTableMap,
                      metricSettings: metricParams.settings.metricSettings.find(
                        (ms) => ms.id === entry.metric.id,
                      ),
                    }),
                    role: entry.role,
                  })),
                  tableFullName: metricSourceTableFullName,
                };
          if (!existingSource) {
            runningSourceData = runningSourceData.concat(updatedSource);
          } else {
            runningSourceData = runningSourceData.map((s) =>
              s.groupId === group.groupId ? updatedSource : s,
            );
          }
          const lockHeld =
            await context.models.incrementalRefresh.updateByExperimentIdIfCurrentExecution(
              experimentId,
              executionId,
              {
                metricSources: runningSourceData,
                // Stamp the current shape version so future runs know this
                // record was written with the current cross-FT layout.
                metricSourcesVersion:
                  INCREMENTAL_REFRESH_METRIC_SOURCES_VERSION,
              },
            );
          if (lockHeld !== true) {
            context.logger.warn(
              "Incremental refresh execution lock lost for experiment: " +
                experimentId,
            );
          }
        }
      },
      queryType: "experimentIncrementalRefreshMaxTimestampMetricsSource",
    });
    queries.push(maxTimestampMetricsSourceQuery);

    // Same-FT stats query: computes statistics for metrics in this source
    // whose role is "complete" (i.e., same-fact-table metrics — both numerator
    // and denominator live here, or non-ratio metrics). Cross-FT ratio
    // metrics in this source are handled by the cross-FT pair pass below.
    const sameFtMetrics = group.metrics
      .filter((e) => e.role === "complete")
      .map((e) => e.metric);

    if (sameFtMetrics.length > 0) {
      // Match standard query runner behavior: quantiles only run overall
      // stats (no pre-computed dimensions), regardless of requested dimensions.
      const runOverallQuantileAnalysis = sameFtMetrics.some(quantileMetricType);
      const dimensionsForPrecomputation =
        org.settings?.disablePrecomputedDimensions || runOverallQuantileAnalysis
          ? []
          : eligibleDimensionsWithSlicesUnderMaxCells;

      const statisticsQuery = await startQuery({
        name: `statistics_${group.groupId}`,
        displayTitle: `Compute Statistics ${sourceName}`,
        query: integration.getIncrementalRefreshStatisticsQuery({
          settings: snapshotSettings,
          activationMetric,
          dimensionsForPrecomputation,
          dimensionsForAnalysis: [],
          factTableMap: params.factTableMap,
          metricSources: [
            {
              tableFullName: metricSourceTableFullName,
              factTableId: group.factTableId,
            },
          ],
          metricSourceCovariateTableFullName,
          unitsSourceTableFullName: unitsTableFullName,
          metrics: sameFtMetrics,
          lastMaxTimestamp: existingSource?.maxTimestamp || null,
        }),
        dependencies: [
          insertMetricsSourceDataQuery.query,
          ...(insertMetricCovariateDataQuery
            ? [insertMetricCovariateDataQuery.query]
            : []),
        ],
        run: (query, setExternalId, queryMetadata) =>
          integration.runIncrementalRefreshStatisticsQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        queryType: "experimentIncrementalRefreshStatistics",
      });
      queries.push(statisticsQuery);
    }
  }

  // Cross-fact-table ratio stats: one query per unordered fact-table pair,
  // covering every cross-FT ratio metric over that pair (in either numerator
  // direction). The stats query joins the two per-FT cache tables on the
  // unit id and depends on both inserts. Cross-FT CUPED is disallowed today
  // (see validateIncrementalPipeline), so no covariate table is wired here.
  type CrossFtPair = {
    factTables: [string, string];
    metrics: FactMetricInterface[];
  };
  const crossFtMetricsByPair = new Map<string, CrossFtPair>();
  selectedMetrics.filter(isFactMetric).forEach((m) => {
    if (!isFactMetric(m)) return;
    const pair = getCrossFtPairFactTableIds(m);
    if (!pair) return;
    const key = pair.join("__");
    if (!crossFtMetricsByPair.has(key)) {
      crossFtMetricsByPair.set(key, { factTables: pair, metrics: [] });
    }
    crossFtMetricsByPair.get(key)?.metrics.push(m);
  });

  for (const { factTables, metrics: crossMetrics } of crossFtMetricsByPair.values()) {
    const [ftA, ftB] = factTables;
    const ftAPipeline = sourcePipelinesByFt.get(ftA);
    const ftBPipeline = sourcePipelinesByFt.get(ftB);
    if (!ftAPipeline || !ftBPipeline) {
      // Defensive: getIncrementalRefreshMetricSources should have produced
      // sources for both FTs given a cross-FT ratio is in selectedMetrics.
      throw new Error(
        `Missing metric source pipeline for cross-fact-table pair ${ftA}__${ftB}`,
      );
    }

    const ftAFactTable = params.factTableMap.get(ftA);
    const ftBFactTable = params.factTableMap.get(ftB);
    const ftAName = ftAFactTable?.name ?? ftA;
    const ftBName = ftBFactTable?.name ?? ftB;

    // Cross-FT stats query never includes quantile metrics (ratio metrics
    // can't be quantiles), so the precomputed-dimension treatment mirrors
    // the non-quantile case.
    const dimensionsForPrecomputation = org.settings?.disablePrecomputedDimensions
      ? []
      : eligibleDimensionsWithSlicesUnderMaxCells;

    const crossStatsQuery = await startQuery({
      name: `statistics_cross_${ftA}_${ftB}`,
      displayTitle: `Compute Cross-Fact Statistics (${ftAName} x ${ftBName})`,
      query: integration.getIncrementalRefreshStatisticsQuery({
        settings: snapshotSettings,
        activationMetric,
        dimensionsForPrecomputation,
        dimensionsForAnalysis: [],
        factTableMap: params.factTableMap,
        metricSources: [
          {
            tableFullName: ftAPipeline.metricSourceTableFullName,
            factTableId: ftA,
          },
          {
            tableFullName: ftBPipeline.metricSourceTableFullName,
            factTableId: ftB,
          },
        ],
        metricSourceCovariateTableFullName: null,
        unitsSourceTableFullName: unitsTableFullName,
        metrics: crossMetrics,
        lastMaxTimestamp: null,
      }),
      dependencies: [
        ftAPipeline.insertMetricsSourceDataQuery.query,
        ftBPipeline.insertMetricsSourceDataQuery.query,
      ],
      run: (query, setExternalId, queryMetadata) =>
        integration.runIncrementalRefreshStatisticsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentIncrementalRefreshStatistics",
    });
    queries.push(crossStatsQuery);
  }
  const runTrafficQuery = shouldRunHealthTrafficQuery({
    snapshotType: params.snapshotType,
    snapshotDimensions: snapshotSettings.dimensions,
    runHealthTrafficQuery: org.settings?.runHealthTrafficQuery,
  });

  if (runTrafficQuery) {
    const trafficQuery = await startQuery({
      name: TRAFFIC_QUERY_NAME,
      query: integration.getExperimentAggregateUnitsQuery({
        ...unitQueryParams,
        dimensions: eligibleDimensionsWithSlices,
        useUnitsTable: true,
      }),
      dependencies: [alterUnitsTableQuery.query],
      run: (query, setExternalId, queryMetadata) =>
        integration.runExperimentAggregateUnitsQuery(
          query,
          setExternalId,
          queryMetadata,
        ),
      queryType: "experimentTraffic",
    });
    queries.push(trafficQuery);
  }
  return queries;
};

export class ExperimentIncrementalRefreshQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentIncrementalRefreshQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(
    params: ExperimentIncrementalRefreshQueryParams,
  ): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;
    if (params.experimentQueryMetadata) {
      this.integration.setAdditionalQueryMetadata?.(
        params.experimentQueryMetadata,
      );
    }

    const incrementalRefreshModel = params.fullRefresh
      ? null
      : await this.context.models.incrementalRefresh.getByExperimentId(
          params.experimentId,
        );

    const experiment = await getExperimentById(
      this.context,
      params.experimentId,
    );
    if (!experiment) {
      throw new Error("Experiment not found");
    }

    // Throws if any settings/experiment is not supported
    await validateIncrementalPipeline({
      org: this.context.org,
      integration: this.integration,
      snapshotSettings: params.snapshotSettings,
      metricMap: params.metricMap,
      factTableMap: params.factTableMap,
      experiment,
      incrementalRefreshModel,
      analysisType: params.fullRefresh ? "main-fullRefresh" : "main-update",
    });

    return await startExperimentIncrementalRefreshQueries(
      this.context,
      params,
      this.integration,
      this.startQuery.bind(this),
    );
  }

  // largely copied from ExperimentResultsQueryRunner
  async runAnalysis(queryMap: QueryMap): Promise<SnapshotResult> {
    const { results: analysesResults, banditResult } =
      await analyzeExperimentResults({
        queryData: queryMap,
        snapshotSettings: this.model.settings,
        analysisSettings: this.model.analyses.map((a) => a.settings),
        variationNames: this.variationNames,
        metricMap: this.metricMap,
      });

    const result: SnapshotResult = {
      analyses: this.model.analyses,
      multipleExposures: 0,
      unknownVariations: [],
      banditResult,
    };

    analysesResults.forEach((results, i) => {
      const analysis = this.model.analyses[i];
      if (!analysis) return;

      analysis.results = results.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = results.unknownVariations || [];
      result.multipleExposures = results.multipleExposures ?? 0;
    });

    //Run health checks
    const healthQuery = queryMap.get(TRAFFIC_QUERY_NAME);
    if (healthQuery) {
      const rows =
        healthQuery.result as ExperimentAggregateUnitsQueryResponseRows;
      const trafficHealth = analyzeExperimentTraffic({
        rows: rows,
        error: healthQuery.error,
        variations: this.model.settings.variations,
      });

      result.health = {
        traffic: trafficHealth,
      };

      // TODO(incremental-refresh): ensure power calculations work
      // const _relativeAnalysis = this.model.analyses.find(
      //   (a) => a.settings.differenceType === "relative",
      // );

      // const isEligibleForMidExperimentPowerAnalysis =
      //   relativeAnalysis &&
      //   this.model.settings.banditSettings === undefined &&
      //   rows &&
      //   rows.length;

      // if (isEligibleForMidExperimentPowerAnalysis) {
      //   const today = new Date();
      //   const phaseStartDate = this.model.settings.startDate;
      //   const experimentMaxLengthDays =
      //     this.context.org.settings?.experimentMaxLengthDays;

      //   const experimentTargetEndDate = addDays(
      //     phaseStartDate,
      //     experimentMaxLengthDays && experimentMaxLengthDays > 0
      //       ? experimentMaxLengthDays
      //       : FALLBACK_EXPERIMENT_MAX_LENGTH_DAYS,
      //   );
      //   const targetDaysRemaining = daysBetween(today, experimentTargetEndDate);
      //   // NB: This does not run a SQL query, but it is a health check that depends on the trafficHealth
      //   result.health.power = analyzeExperimentPower({
      //     trafficHealth,
      //     targetDaysRemaining,
      //     analysis: relativeAnalysis,
      //     goalMetrics: this.model.settings.goalMetrics,
      //     variationsSettings: this.model.settings.variations,
      //   });
      // }
      const analysisForCovariateImbalance = this.model.analyses.find(
        (a) => a.settings.useCovariateAsResponse === true,
      );
      const isEligibleForCovariateImbalanceAnalysis =
        !!analysisForCovariateImbalance;
      if (isEligibleForCovariateImbalanceAnalysis) {
        result.health.covariateImbalance = tabulateCovariateImbalance(
          analysisForCovariateImbalance,
          this.model.settings.goalMetrics,
          this.model.settings.guardrailMetrics,
          this.model.settings.secondaryMetrics,
          this.model.settings.metricSettings,
        );
      }
    }

    return result;
  }

  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.context, this.model.id);
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
    const snapshotStatus =
      status === "running"
        ? "running"
        : status === "failed"
          ? "error"
          : "success";

    const updates: Partial<ExperimentSnapshotInterface> = {
      queries,
      runStarted,
      error,
      ...result,
      status: snapshotStatus,
    };
    await updateSnapshot({
      context: this.context,
      id: this.model.id,
      updates,
    });
    if (
      this.model.report &&
      ["failed", "partially-succeeded", "succeeded"].includes(status)
    ) {
      await updateReport(this.model.organization, this.model.report, {
        snapshot: this.model.id,
      });
    }

    // Release the incremental refresh lock on any terminal status
    // TODO: Properly handle partially-succeeded status that also becomes terminal??
    if (snapshotStatus !== "running") {
      await this.context.models.incrementalRefresh
        .releaseLock(this.model.experiment, this.model.id)
        .catch((e) =>
          this.context.logger.warn(
            e,
            "Failed to release incremental refresh lock on terminal status",
          ),
        );
    }

    return {
      ...this.model,
      ...updates,
    };
  }
}
