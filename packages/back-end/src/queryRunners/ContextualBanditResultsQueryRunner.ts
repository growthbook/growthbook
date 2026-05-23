// SMITH: this runner is the single integration seam between the CB orchestrator
// and Luke's real SQL + Python stats engine. The mock `runContextualBanditQuery`
// and `runContextualStatsEngine` are wired up below; replacing them with the
// real implementations should not require touching this file as long as their
// signatures stay stable.
import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { ExposureQuery } from "shared/types/datasource";
import {
  attributesToCondition,
  enforceContextCap,
  getContextualBanditSettingsForStatsEngine,
  persistContextualBanditEvent,
} from "back-end/src/services/contextualBandits";
import {
  ContextualBanditRow,
  runContextualBanditQuery,
} from "back-end/src/services/contextualBanditSql";
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

    return [
      await this.startQuery({
        name: CONTEXTUAL_BANDIT_ROWS_QUERY_NAME,
        // The query body is generated inside `runContextualBanditQuery` (a
        // STUB today); the placeholder gets persisted on the QueryDoc and
        // surfaced in the UI. Including the CBS id keeps the cache key
        // unique-per-snapshot so back-to-back runs don't reuse stale rows.
        query: `-- contextual-bandit rows stub for ${this.model.id}`,
        dependencies: [],
        run: async () => {
          const rows = await runContextualBanditQuery(
            this.context,
            cb,
            this.integration.datasource,
            eaq,
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
      []) as ContextualBanditRow[];

    // 1. Tag rows with derived contextIds (stable hash of experimentId + the
    //    surviving attribute map).
    const tagged = rows.map((r) => ({
      ...r,
      contextId: deriveContextId(
        this.snapshotSettings!.experimentId,
        attributesToCondition(r.attributes),
      ),
    }));

    // 2. Enforce the Mongo cap on (contexts × variations).
    const numVariations =
      this.snapshotSettings.variations.length || this.variationNames.length;
    const { rows: trimmed } = enforceContextCap(
      tagged,
      this.snapshotSettings.maxContexts,
      numVariations,
    );

    // 3. Build the stats-engine settings from the frozen snapshot + latest
    //    CBE weights for this (experiment, phase).
    const cb = await this.loadCbDoc();
    const latestCBE =
      await this.context.contextualBanditEvents.getLatestForExperiment(
        this.snapshotSettings.experimentId,
        this.snapshotSettings.phase,
      );
    const currentWeightsByContext: Record<string, number[]> = latestCBE
      ? Object.fromEntries(
          (latestCBE.tree?.leaves ?? []).map(
            (l: { contextId: string; weights: number[] }) => [
              l.contextId,
              l.weights,
            ],
          ),
        )
      : {};

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

    // 4. Hand the tagged + capped rows + settings to the (stub) stats engine.
    return runContextualStatsEngine(statsSettings, trimmed);
  }

  async getLatestModel(): Promise<ContextualBanditSnapshotInterface> {
    const obj =
      await this.context.contextualBanditSnapshots.getBySnapshotIdInOrg(
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
      updates.weightsWereUpdated = result.weightsWereUpdated;
    }

    await this.context.contextualBanditSnapshots.updateById(
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
    const cb = await this.context.contextualBandits.getByExperimentId(
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
}
