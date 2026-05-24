// SMITH: this runner is the single integration seam between the CB orchestrator
// and the contextual bandit SQL + Python stats engine.
import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { attributeConditionFromMetricRow } from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { ExposureQuery } from "shared/types/datasource";
import {
  attributesToCondition,
  enforceContextCap,
  getContextualBanditSettingsForStatsEngine,
  persistContextualBanditEvent,
} from "back-end/src/services/contextualBandits";
import {
  executeContextualBanditQuery,
  getContextualBanditQuerySql,
} from "back-end/src/services/contextualBanditSql";
import {
  loadContextualBanditSnapshotContext,
  type ContextualBanditSnapshotContext,
} from "back-end/src/services/contextualBanditQueries";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import {
  ContextualBanditResult,
  runContextualStatsEngine,
} from "back-end/src/services/contextualBanditStats";
import { QueryMap, QueryRunner } from "./QueryRunner";

/**
 * Parameters the orchestrator hands to the runner. The frozen snapshot
 * settings carry everything reproducibility-critical; `variationNames` is
 * supplied separately because the typed snapshot settings only persist
 * variation IDs + traffic weights (display names live on the experiment doc).
 */
export type ContextualBanditResultsQueryParams = {
  snapshotSettings: ContextualBanditSnapshotSettings;
  variationNames: string[];
};

/** The successful output of one CB run. Returned from `runAnalysis`. */
export type ContextualBanditQueryRunResult = ContextualBanditResult;

/**
 * Name of the single sub-query this runner manages. Kept as a constant so the
 * `runAnalysis` lookup can't drift from the `startQueries` registration.
 */
export const CONTEXTUAL_BANDIT_ROWS_QUERY_NAME = "contextual-bandit-rows";

export class ContextualBanditResultsQueryRunner extends QueryRunner<
  ContextualBanditSnapshotInterface,
  ContextualBanditResultsQueryParams,
  ContextualBanditQueryRunResult
> {
  private snapshotSettings?: ContextualBanditSnapshotSettings;
  private variationNames: string[] = [];
  private cachedCb?: ContextualBanditInterface;
  private cachedExposureQuery?: ExposureQuery;
  private cachedQueryContext?: ContextualBanditSnapshotContext;

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

    const cb = await this.loadCbDoc();
    const eaq = this.loadExposureQuery();
    const sql = await getContextualBanditQuerySql(
      this.context,
      cb,
      this.integration.datasource,
      eaq,
    );

    return [
      await this.startQuery({
        name: CONTEXTUAL_BANDIT_ROWS_QUERY_NAME,
        query: sql,
        dependencies: [],
        run: async (query) => {
          const { rows } = await executeContextualBanditQuery(
            this.context,
            cb,
            this.integration.datasource,
            eaq,
            query,
          );
          return { rows };
        },
        // SMITH: re-using the legacy `experimentResults` enum value is
        // deliberate (see plan, Appendix C). A dedicated
        // `"contextualBanditResults"` value is deferred until the SQL is
        // real enough to justify cost-attribution carve-outs.
        queryType: "experimentResults",
      }),
    ];
  }

  async runAnalysis(
    queryMap: QueryMap,
  ): Promise<ContextualBanditQueryRunResult> {
    // TODO(holdout-v1.5): for holdout support, `runAnalysis` will need to
    // receive both the holdout sample and the bandit sample (currently the
    // single `contextual-bandit-rows` query) and compute the lift comparison
    // alongside the per-leaf weights. The result shape change must be paired
    // with validator updates per the SMITH rule in contextualBanditStats.ts.
    // See contextual-bandit-fix-prompt.md.
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
    // `result` is set to the raw rows array by the QueryRunner base class
    // (see `executeQuery`'s success branch in QueryRunner.ts). The QueryDoc
    // types this as Record<string, any> | Record<string, any>[]; cast back
    // to the row type known to the stats engine.
    const rows = (queryDoc.result ??
      queryDoc.rawResult ??
      []) as ExperimentMetricQueryResponseRows;

    const attributeColumns = this.snapshotSettings.contextualAttributes;
    const catchAllContextId = deriveContextId(
      this.snapshotSettings.experimentId,
      {},
    );

    // 1. Tag rows with derived contextIds (stable hash of experimentId + the
    //    surviving attribute map).
    const tagged = rows.map((r) => ({
      ...r,
      contextId: deriveContextId(
        this.snapshotSettings!.experimentId,
        attributesToCondition(
          attributeConditionFromMetricRow(r, attributeColumns),
        ),
      ),
    }));

    // 2. Enforce the Mongo cap on (contexts × variations).
    const numVariations =
      this.snapshotSettings.variations.length || this.variationNames.length;
    const { rows: trimmed } = enforceContextCap(
      tagged,
      this.snapshotSettings.maxContexts,
      numVariations,
      catchAllContextId,
      attributeColumns,
    );

    // 3. Build the stats-engine settings from the frozen snapshot + latest
    //    CBE weights for this (experiment, phase).
    const cb = await this.loadCbDoc();
    const currentWeightsByContext: Record<string, number[]> =
      Object.fromEntries(
        (cb.phases[this.snapshotSettings.phase]?.currentLeafWeights ?? []).map(
          (lw) => [lw.contextId, lw.weights],
        ),
      );

    const variationsForStats = this.snapshotSettings.variations.map((v, i) => ({
      id: v.id,
      name: this.variationNames[i] ?? v.id,
    }));

    const statsSettings = getContextualBanditSettingsForStatsEngine(
      cb,
      this.snapshotSettings.phase,
      variationsForStats,
      currentWeightsByContext,
    );

    const queryContext = await this.ensureQueryContext();
    const coverage = this.snapshotSettings.variations.reduce(
      (sum, v) => sum + v.weight,
      0,
    );
    const phaseStart = new Date(this.snapshotSettings.startDate).getTime();
    const phaseEnd = this.snapshotSettings.endDate
      ? new Date(this.snapshotSettings.endDate).getTime()
      : Date.now();
    const phaseLengthDays = Math.max(
      (phaseEnd - phaseStart) / (1000 * 60 * 60 * 24),
      1 / 24,
    );
    const decisionMetricId = this.snapshotSettings.goalMetrics[0];
    if (!decisionMetricId) {
      throw new Error("Contextual bandit snapshot is missing a goal metric");
    }

    return runContextualStatsEngine(statsSettings, trimmed, {
      snapshotId: this.model.id,
      sql: queryDoc.query,
      decisionMetricId,
      snapshotSettings: queryContext.snapshotSettings,
      analysisSettings: queryContext.analysisSettings,
      metricMap: queryContext.metricMap,
      variations: this.snapshotSettings.variations.map((v, i) => ({
        id: v.id,
        name: this.variationNames[i] ?? v.id,
        weight: v.weight,
      })),
      coverage,
      phaseLengthDays,
    });
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

    // On a successful run, fan out the side effects (CBE create, CB phase
    // weight patch, SDK payload refresh) *before* the final CBS write so the
    // CBS row's `contextualBanditEventId` pointer is never published in a
    // half-consistent state.
    if (status === "succeeded" && result) {
      const cbe = await persistContextualBanditEvent(
        this.context,
        this.model,
        result,
      );
      updates.contextualBanditEventId = cbe.id;
      updates.weightsWereUpdated = cbe.weightsWereUpdated;
    }

    await this.context.models.contextualBanditSnapshots.updateById(
      this.model.id,
      updates,
    );

    return {
      ...this.model,
      ...updates,
    };
  }

  /**
   * Resolves the parent ContextualBandit doc for the snapshot under analysis.
   * Cached on the runner so `startQueries` and `runAnalysis` only hit Mongo
   * once per run.
   */
  private async loadCbDoc(): Promise<ContextualBanditInterface> {
    if (this.cachedCb) return this.cachedCb;
    if (!this.snapshotSettings) {
      throw new Error(
        "ContextualBanditResultsQueryRunner: snapshotSettings missing in loadCbDoc",
      );
    }
    const cb = await this.context.models.contextualBandits.getByExperimentId(
      this.snapshotSettings.experimentId,
    );
    if (!cb) {
      throw new Error(
        `No CB doc for experiment ${this.snapshotSettings.experimentId}`,
      );
    }
    this.cachedCb = cb;
    return cb;
  }

  /**
   * Resolves the exposure-assignment query (EAQ) referenced by the snapshot
   * from the integration's datasource settings.
   */
  private loadExposureQuery(): ExposureQuery {
    if (this.cachedExposureQuery) return this.cachedExposureQuery;
    if (!this.snapshotSettings) {
      throw new Error(
        "ContextualBanditResultsQueryRunner: snapshotSettings missing in loadExposureQuery",
      );
    }
    const eaq = this.integration.datasource.settings?.queries?.exposure?.find(
      (q) => q.id === this.snapshotSettings!.exposureQueryId,
    );
    if (!eaq) {
      throw new Error(
        `Exposure query missing on datasource ${this.snapshotSettings.datasourceId}: ${this.snapshotSettings.exposureQueryId}`,
      );
    }
    this.cachedExposureQuery = eaq;
    return eaq;
  }

  private async loadQueryContext(
    cb: ContextualBanditInterface,
    eaq: ExposureQuery,
  ): Promise<ContextualBanditSnapshotContext> {
    const experiment = await getExperimentById(
      this.context,
      this.snapshotSettings!.experimentId,
    );
    if (!experiment) {
      throw new Error(
        `Experiment not found: ${this.snapshotSettings!.experimentId}`,
      );
    }
    return loadContextualBanditSnapshotContext(
      this.context,
      experiment,
      this.snapshotSettings!.phase,
      cb,
      this.integration.datasource,
      eaq,
    );
  }

  private async ensureQueryContext(): Promise<ContextualBanditSnapshotContext> {
    if (this.cachedQueryContext) {
      return this.cachedQueryContext;
    }
    const cb = await this.loadCbDoc();
    const eaq = this.loadExposureQuery();
    this.cachedQueryContext = await this.loadQueryContext(cb, eaq);
    return this.cachedQueryContext;
  }
}
