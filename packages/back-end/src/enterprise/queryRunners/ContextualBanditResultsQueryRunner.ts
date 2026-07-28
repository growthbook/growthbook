import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
  ContextualBanditSrmLatestPeriod,
  ContextualBanditAnalysisSummary,
  queryHasContextualBanditSrmColumns,
} from "shared/validators";
import { buildUnitsQuerySettingsFromCb } from "shared/util";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import {
  ContextualBanditSrmQueryResponseRows,
  ExperimentAggregateUnitsQueryResponseRows,
  ExperimentMetricQueryResponseRows,
} from "shared/types/integrations";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotTraffic,
} from "shared/types/experiment-snapshot";
import {
  buildSnapshotSettingsForCb,
  getContextualBanditSettingsForStatsEngine,
  persistContextualBanditEvent,
} from "back-end/src/enterprise/services/contextualBandits";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { hasUsableContextualBanditTargeting } from "back-end/src/integrations/sql/ctes/contextual-bandit-experiment-units-cte";
import { logger } from "back-end/src/util/logger";
import {
  ContextualBanditResult,
  runContextualStatsEngine,
} from "back-end/src/enterprise/services/contextualBanditStats";
import { QueryMap, QueryRunner } from "back-end/src/queryRunners/QueryRunner";
import { chi2pvalue } from "back-end/src/util/stats";
import { analyzeExperimentTraffic } from "back-end/src/services/stats";

/** Orchestrator-to-runner params; `variationNames` is separate because frozen settings only persist IDs/weights. */
export type ContextualBanditResultsQueryParams = {
  snapshotSettings: ContextualBanditSnapshotSettings;
  variationNames: string[];
};

/** Raw observed vs expected units for one leaf, indexed by variation, for a single bandit period. */
export type ContextualBanditSrmLeafBreakdown =
  ContextualBanditSrmLatestPeriod["leaves"][number];

export type ContextualBanditSrmResult = {
  statistic: number;
  pValue: number;
  degreesOfFreedom: number;
  latestPeriod?: ContextualBanditSrmLatestPeriod;
};

/** The successful output of one CB run. Returned from `runAnalysis`. */
export type ContextualBanditQueryRunResult = ContextualBanditResult & {
  srm?: ContextualBanditSrmResult;
  traffic?: ExperimentSnapshotTraffic;
  multipleExposures?: number;
};

/** Name of the decision-metric sub-query; shared by `startQueries` and `runAnalysis`. */
export const CONTEXTUAL_BANDIT_ROWS_QUERY_NAME = "contextual-bandit-rows";

/** Name of the optional SQL SRM sub-query; shared by `startQueries` and `runAnalysis`. */
export const CONTEXTUAL_BANDIT_SRM_QUERY_NAME = "contextual-bandit-srm";

/** Name of the traffic/health sub-query; shared by `startQueries` and `runAnalysis`. */
export const CONTEXTUAL_BANDIT_TRAFFIC_QUERY_NAME = "contextual-bandit-traffic";

export class ContextualBanditResultsQueryRunner extends QueryRunner<
  ContextualBanditSnapshotInterface,
  ContextualBanditResultsQueryParams,
  ContextualBanditQueryRunResult
> {
  private snapshotSettings?: ContextualBanditSnapshotSettings;
  private variationNames: string[] = [];
  private cachedCb?: ContextualBanditInterface;
  private cachedMetricMap?: Map<string, ExperimentMetricInterface>;

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(
    params: ContextualBanditResultsQueryParams,
  ): Promise<Queries> {
    this.snapshotSettings = params.snapshotSettings;
    this.variationNames = params.variationNames;

    await this.loadCbDoc();

    // TODO(query-runner): remove need for snapshotSettings
    const expSnapshotSettings = buildSnapshotSettingsForCb(
      this.snapshotSettings,
    );
    const cbUnitsSettings = buildUnitsQuerySettingsFromCb(
      this.snapshotSettings,
    );

    if (!hasUsableContextualBanditTargeting(cbUnitsSettings)) {
      logger.warn(
        `Contextual bandit ${this.snapshotSettings.experimentId} (snapshot ${this.model.id}) has no usable targeting attribute columns ` +
          `(configured: [${(
            this.snapshotSettings.contextualAttributes ?? []
          ).join(", ")}]); falling back to a single global context and ` +
          `updating variation weights identically for all users.`,
      );
    }

    const decisionMetricId = this.snapshotSettings.decisionMetric;
    if (!decisionMetricId) {
      throw new Error(
        "Contextual bandit snapshot is missing a decision metric",
      );
    }

    const metricMap = await this.getMetricMapCached();
    const decisionMetric = metricMap.get(decisionMetricId);
    if (!decisionMetric) {
      throw new Error(
        `Contextual bandit decision metric not found: ${decisionMetricId}`,
      );
    }
    if (!isFactMetric(decisionMetric)) {
      throw new Error(
        `Contextual bandit decision metric ${decisionMetricId} must be a fact metric`,
      );
    }
    if (
      !this.integration.getExperimentFactMetricsQuery ||
      !this.integration.runExperimentFactMetricsQuery
    ) {
      throw new Error(
        `Datasource integration does not support fact metric queries required for contextual bandit decision metric ${decisionMetricId}`,
      );
    }
    const factTableMap = await getFactTableMap(this.context);

    const sql = this.integration.getExperimentFactMetricsQuery({
      activationMetric: null,
      dimensions: [],
      metrics: [decisionMetric],
      segment: null,
      settings: expSnapshotSettings,
      unitsSource: "exposureQuery",
      unitsSettings: cbUnitsSettings,
      unitsTableFullName: "",
      factTableMap,
    });

    const queries: Queries = [
      await this.startQuery({
        name: CONTEXTUAL_BANDIT_ROWS_QUERY_NAME,
        query: sql,
        dependencies: [],
        run: async (query, setExternalId, queryMetadata) => {
          const res = await this.integration.runExperimentFactMetricsQuery!(
            query,
            setExternalId,
            queryMetadata,
          );
          return { rows: res.rows as ExperimentMetricQueryResponseRows };
        },
        queryType: "experimentResults",
      }),
    ];

    const trafficSql = this.integration.getExperimentAggregateUnitsQuery({
      activationMetric: null,
      dimensions: [],
      segment: null,
      settings: expSnapshotSettings,
      unitsSettings: cbUnitsSettings,
      factTableMap,
      useUnitsTable: false,
    });
    queries.push(
      await this.startQuery({
        name: CONTEXTUAL_BANDIT_TRAFFIC_QUERY_NAME,
        query: trafficSql,
        dependencies: [],
        run: async (query, setExternalId, queryMetadata) => {
          const res = await this.integration.runExperimentAggregateUnitsQuery(
            query,
            setExternalId,
            queryMetadata,
          );
          return { rows: res.rows };
        },
        queryType: "experimentTraffic",
      }),
    );

    const canComputeSrm = queryHasContextualBanditSrmColumns(
      cbUnitsSettings.exposureQuery.query,
    );
    if (!canComputeSrm) {
      logger.info(
        `Contextual bandit ${this.snapshotSettings.experimentId} (snapshot ${this.model.id}) assignment query does not select the SRM columns ` +
          `(leaf_id, bandit_version, variation_weights); skipping SRM.`,
      );
    }

    if (
      canComputeSrm &&
      this.integration.getContextualBanditSrmQuery &&
      this.integration.runContextualBanditSrmQuery
    ) {
      const srmSql = this.integration.getContextualBanditSrmQuery({
        settings: cbUnitsSettings,
      });
      queries.push(
        await this.startQuery({
          name: CONTEXTUAL_BANDIT_SRM_QUERY_NAME,
          query: srmSql,
          dependencies: [],
          run: async (query, setExternalId, queryMetadata) => {
            const res = await this.integration.runContextualBanditSrmQuery!(
              query,
              setExternalId,
              queryMetadata,
            );
            return { rows: res.rows };
          },
          queryType: "experimentTraffic",
        }),
      );
    }

    return queries;
  }

  async runAnalysis(
    queryMap: QueryMap,
  ): Promise<ContextualBanditQueryRunResult> {
    // TODO(holdout-v1.5): accept both holdout and bandit samples and compute lift alongside per-leaf weights.
    if (!this.snapshotSettings) {
      throw new Error(
        "ContextualBanditResultsQueryRunner: snapshotSettings missing in runAnalysis",
      );
    }

    const queryDoc = queryMap.get(CONTEXTUAL_BANDIT_ROWS_QUERY_NAME);
    if (!queryDoc) {
      throw new Error(
        `ContextualBanditResultsQueryRunner: query "${CONTEXTUAL_BANDIT_ROWS_QUERY_NAME}" missing from queryMap`,
      );
    }
    const rows = (queryDoc.result ??
      queryDoc.rawResult ??
      []) as ExperimentMetricQueryResponseRows;

    const srm = this.extractSrmResult(queryMap);

    const multipleExposures = Math.max(
      0,
      rows
        .filter((r) => r.variation === "__multiple__")
        .reduce((sum, r) => sum + (Number(r.users) || 0), 0),
    );

    const cb = await this.loadCbDoc();

    const statsSettings = getContextualBanditSettingsForStatsEngine(
      cb,
      this.snapshotSettings.variations.map((v) => v.id),
    );

    const expSnapshotSettings = buildSnapshotSettingsForCb(
      this.snapshotSettings,
    );

    // Traffic rows are tagged with the variation key (emitted by the assignment query),
    // not the internal variation id, so analyzeExperimentTraffic must be
    // keyed by key.
    const traffic = this.extractTraffic(
      queryMap,
      this.snapshotSettings.variations.map((v, i) => ({
        id: cb.variations?.[i]?.key || String(i),
        weight: v.weight,
      })),
    );

    const decisionMetricId = this.snapshotSettings.decisionMetric;
    if (!decisionMetricId) {
      throw new Error(
        "Contextual bandit snapshot is missing a decision metric",
      );
    }
    const metricMap = await this.getMetricMapCached();
    const analysisSettings: ExperimentSnapshotAnalysisSettings = {
      dimensions: [],
      statsEngine: "bayesian",
      differenceType: "relative",
      baselineVariationIndex: 0,
      numGoalMetrics: 1,
      numGuardrailMetrics: 0,
    };

    const coverage = this.snapshotSettings.variations.reduce(
      (sum, v) => sum + v.weight,
      0,
    );
    const windowStart = new Date(this.snapshotSettings.startDate).getTime();
    const windowEnd = this.snapshotSettings.endDate
      ? new Date(this.snapshotSettings.endDate).getTime()
      : Date.now();
    const windowLengthDays = Math.max(
      (windowEnd - windowStart) / (1000 * 60 * 60 * 24),
      1 / 24,
    );

    const analysis = await runContextualStatsEngine(statsSettings, rows, {
      snapshotId: this.model.id,
      decisionMetricId,
      snapshotSettings: expSnapshotSettings,
      analysisSettings,
      metricMap,
      variations: this.snapshotSettings.variations.map((v, i) => ({
        id: v.id,
        name: this.variationNames[i] ?? v.id,
        weight: v.weight,
      })),
      coverage,
      phaseLengthDays: windowLengthDays,
    });

    return { ...analysis, srm, traffic, multipleExposures };
  }

  private extractTraffic(
    queryMap: QueryMap,
    variations: { id: string; weight: number }[],
  ): ExperimentSnapshotTraffic | undefined {
    const trafficDoc = queryMap.get(CONTEXTUAL_BANDIT_TRAFFIC_QUERY_NAME);
    if (!trafficDoc) {
      return undefined;
    }
    const rows = (trafficDoc.result ??
      trafficDoc.rawResult ??
      []) as ExperimentAggregateUnitsQueryResponseRows;
    return analyzeExperimentTraffic({
      rows,
      error: trafficDoc.error,
      variations,
    });
  }

  private extractSrmResult(
    queryMap: QueryMap,
  ): ContextualBanditSrmResult | undefined {
    const srmDoc = queryMap.get(CONTEXTUAL_BANDIT_SRM_QUERY_NAME);
    if (!srmDoc) {
      return undefined;
    }
    const srmRows = (srmDoc.result ??
      srmDoc.rawResult ??
      []) as ContextualBanditSrmQueryResponseRows;
    const summary = srmRows.find((r) => r.row_type === "summary");
    if (!summary) {
      return undefined;
    }
    const degreesOfFreedom = summary.degrees_of_freedom;
    if (!(degreesOfFreedom > 0)) {
      return undefined;
    }
    return {
      statistic: summary.statistic,
      pValue: chi2pvalue(summary.statistic, degreesOfFreedom),
      degreesOfFreedom,
      ...this.extractSrmLatestPeriod(srmRows),
    };
  }

  private extractSrmLatestPeriod(
    srmRows: ContextualBanditSrmQueryResponseRows,
  ): Pick<ContextualBanditSrmResult, "latestPeriod"> {
    const numVariations =
      this.snapshotSettings?.variations.length ?? this.variationNames.length;
    const cellRows = srmRows.filter((r) => r.row_type === "cell");
    if (!cellRows.length) {
      return {};
    }

    const byLeaf = new Map<string, ContextualBanditSrmLeafBreakdown>();
    let banditVersion = "";
    for (const r of cellRows) {
      banditVersion = r.bandit_version || banditVersion;
      const variationIndex = Number(r.variation);
      if (
        !Number.isInteger(variationIndex) ||
        variationIndex < 0 ||
        variationIndex >= numVariations
      ) {
        continue;
      }
      let leaf = byLeaf.get(r.leaf_id);
      if (!leaf) {
        leaf = {
          leafId: r.leaf_id,
          observed: new Array(numVariations).fill(0),
          expected: new Array(numVariations).fill(0),
        };
        byLeaf.set(r.leaf_id, leaf);
      }
      leaf.observed[variationIndex] = r.observed;
      leaf.expected[variationIndex] = r.expected;
    }

    if (!byLeaf.size) {
      return {};
    }

    return {
      latestPeriod: {
        banditVersion,
        leaves: Array.from(byLeaf.values()),
      },
    };
  }

  async getLatestModel(): Promise<ContextualBanditSnapshotInterface> {
    const obj =
      await this.context.models.contextualBanditSnapshots.getBySnapshotIdInOrg(
        this.model.id,
      );
    if (!obj) {
      throw new Error(
        `Could not load contextual bandit snapshot: ${this.model.id}`,
      );
    }
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
    result?: ContextualBanditQueryRunResult;
    error?: string;
  }): Promise<ContextualBanditSnapshotInterface> {
    const updates: UpdateProps<ContextualBanditSnapshotInterface> = {
      queries,
      ...(runStarted ? { runStarted } : {}),
      ...(error !== undefined ? { error } : {}),
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };

    // The lightweight health summary written to the CB doc after the snapshot is
    // linked to its event. Deferred until after the snapshot update so the
    // durable `contextualBanditEventId` link is persisted first.
    let pendingAnalysisSummary: ContextualBanditAnalysisSummary | undefined;

    if (status === "succeeded" && result) {
      const latest = await this.getLatestModel();
      if (!latest.contextualBanditEventId) {
        const cbe = await persistContextualBanditEvent(
          this.context,
          this.model,
          result,
        );
        updates.contextualBanditEventId = cbe.id;
        updates.weightsWereUpdated = cbe.weightsWereUpdated;
        if (result.srm) {
          updates.srm = result.srm;
        }
        if (result.traffic) {
          updates.traffic = result.traffic;
        }
        if (result.multipleExposures !== undefined) {
          updates.multipleExposures = result.multipleExposures;
        }

        // Similar to experiment `analysisSummary` pattern, persist a lightweight health
        // summary on the CB doc so list views can render the shared status without loading
        // the full snapshot.
        const summaryTotalUsers =
          result.traffic?.overall?.variationUnits?.reduce(
            (sum, n) => sum + n,
            0,
          ) ?? 0;
        pendingAnalysisSummary = {
          snapshotId: this.model.id,
          health: {
            srm: result.srm?.pValue ?? null,
            multipleExposures: result.multipleExposures ?? 0,
            totalUsers: summaryTotalUsers,
          },
        };
      }
    }

    // Persist the snapshot (including `contextualBanditEventId`) before writing the
    // health summary.
    await this.context.models.contextualBanditSnapshots.updateById(
      this.model.id,
      updates,
    );

    if (pendingAnalysisSummary) {
      await this.context.models.contextualBandits.patchAnalysisSummary(
        this.model.contextualBandit,
        pendingAnalysisSummary,
      );
    }

    return {
      ...this.model,
      ...updates,
    };
  }

  private async loadCbDoc(): Promise<ContextualBanditInterface> {
    if (this.cachedCb) return this.cachedCb;
    if (!this.snapshotSettings) {
      throw new Error(
        "ContextualBanditResultsQueryRunner: snapshotSettings missing in loadCbDoc",
      );
    }
    const cb = await this.context.models.contextualBandits.getById(
      this.snapshotSettings.contextualBanditId,
    );
    if (!cb) {
      throw new Error(
        `No CB doc for experiment ${this.snapshotSettings.experimentId}: ${this.snapshotSettings.contextualBanditId}`,
      );
    }
    this.cachedCb = cb;
    return cb;
  }

  private async getMetricMapCached(): Promise<
    Map<string, ExperimentMetricInterface>
  > {
    if (this.cachedMetricMap) return this.cachedMetricMap;
    this.cachedMetricMap = await getMetricMap(this.context);
    return this.cachedMetricMap;
  }
}
