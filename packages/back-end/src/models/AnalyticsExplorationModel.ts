import { z } from "zod";
import {
  ExplorationConfig,
  ApiAnalyticsExploration,
  ProductAnalyticsExploration,
  productAnalyticsExplorationValidator,
} from "shared/validators";
import md5 from "md5";
import {
  calculateProductAnalyticsDateRange,
  getDateGranularity,
} from "shared/enterprise";
import { getValidDate } from "shared/dates";
import {
  JOURNEY_CACHE_CANDIDATE_LIMIT,
  journeyFamilyIdentity,
  journeyCacheCandidateVerdict,
  journeyResultCanServe,
  toClientJourneyExploration,
} from "shared/journeys";
import {
  getQueryById,
  toQueryApiInterface,
} from "back-end/src/models/QueryModel";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";
import {
  getProductAnalyticsExplorationUrl,
  runProductAnalyticsExploration,
} from "back-end/src/enterprise/services/product-analytics";
import analyticsExplorationApiSpec, {
  type makeExplorationEndpoint,
  postMetricExplorationEndpoint,
  postFactTableExplorationEndpoint,
  postDataSourceExplorationEndpoint,
  postFunnelExplorationEndpoint,
  postJourneyExplorationEndpoint,
} from "back-end/src/api/specs/analytics-exploration.spec";
import { MakeModelClass } from "./BaseModel";

function toApiInterface(
  exploration: ProductAnalyticsExploration,
): ApiAnalyticsExploration {
  const client = toClientJourneyExploration(exploration, exploration.config);
  return {
    id: client.id,
    dateCreated: client.dateCreated.toISOString(),
    dateUpdated: client.dateUpdated.toISOString(),
    datasource: client.datasource,
    status: client.status,
    dateStart: client.dateStart,
    dateEnd: client.dateEnd,
    error: client.error ?? null,
    result: client.result,
    config: client.config,
  };
}

function makeExplorationHandler<
  Exp extends z.ZodType<ApiAnalyticsExploration>,
  Body extends z.ZodType<ExplorationConfig>,
>(endpoint: ReturnType<typeof makeExplorationEndpoint<Exp, Body>>) {
  return defineCustomApiHandler({
    ...endpoint,
    reqHandler: async (req) => {
      const exploration = await runProductAnalyticsExploration(
        req.context,
        req.body,
        { cache: req.query.cache },
      );

      if (!exploration) {
        return {
          exploration: null,
          query: null,
          message:
            'No cached result found for this config. Try again shortly or use cache: "preferred".',
        };
      }

      const queryId = exploration.queries?.[0]?.query;
      const queryDoc = queryId
        ? await getQueryById(req.context, queryId)
        : null;

      return {
        exploration: toApiInterface(exploration),
        query: queryDoc ? toQueryApiInterface(queryDoc) : null,
        explorationUrl: getProductAnalyticsExplorationUrl(req.body),
      };
    },
  });
}

const COLLECTION_NAME = "analyticsexploration";
const BaseClass = MakeModelClass({
  schema: productAnalyticsExplorationValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "ae_",
  globallyUniquePrimaryKeys: false,
  additionalIndexes: [],
  apiConfig: {
    modelKey: "analyticsExplorations",
    openApiSpec: analyticsExplorationApiSpec,
    customHandlers: [
      makeExplorationHandler(postMetricExplorationEndpoint),
      makeExplorationHandler(postFactTableExplorationEndpoint),
      makeExplorationHandler(postDataSourceExplorationEndpoint),
      makeExplorationHandler(postFunnelExplorationEndpoint),
      makeExplorationHandler(postJourneyExplorationEndpoint),
    ],
  },
});

export class AnalyticsExplorationModel extends BaseClass {
  // Every saved exploration in the org, ignoring the caller's read permissions.
  // Only for authoritative dependency scans (e.g. blocking deletion of a fact
  // table column an exploration still references), where missing an exploration
  // the caller cannot read would let the delete through and leave that
  // exploration generating SQL for a column that no longer exists. Never return
  // these to the caller.
  public async dangerousGetAllForDependencyScan(): Promise<
    ProductAnalyticsExploration[]
  > {
    return this._find({}, { bypassReadPermissionChecks: true });
  }

  public getConfigHashes(config: ExplorationConfig) {
    const dataset = config.dataset;
    if (!dataset) return null;

    const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

    const dimensions = config.dimensions.map((dimension) => {
      if (dimension.dimensionType === "date") {
        // Evaluate "auto" granularity for higher cache hit rates
        return {
          ...dimension,
          dateGranularity: getDateGranularity(
            dimension.dateGranularity,
            dateRange,
          ),
        };
      }
      return dimension;
    });

    // General settings hash
    const generalSettingsHash = md5(
      JSON.stringify({
        type: config.type,
        datasource: config.datasource,
        dimensions: dimensions,
        factTableId: dataset.type === "fact_table" ? dataset.factTableId : null,
        table: dataset.type === "data_source" ? dataset.table : null,
        path: dataset.type === "data_source" ? dataset.path : null,
        timestampColumn:
          dataset.type === "data_source" ? dataset.timestampColumn : null,
        // Funnel-specific keys: unit and concurrency window affect query
        // results but live at the dataset level rather than per-step.
        funnelUnit: dataset.type === "funnel" ? dataset.unit : null,
        funnelConcurrencyWindowSeconds:
          dataset.type === "funnel"
            ? (dataset.concurrencyWindowSeconds ?? 0)
            : null,
        journeyFamily:
          dataset.type === "journey" ? journeyFamilyIdentity(dataset) : null,
      }),
    );

    // Value hashes. Funnels treat the whole steps array as one logical
    // "value" (decision in the funnels plan): a single hash invalidates
    // the cache on any step change. Per-step incremental refresh is a
    // future optimization.
    const valueHashes =
      dataset.type === "funnel"
        ? [md5(JSON.stringify(dataset.steps))]
        : dataset.type === "journey"
          ? [md5("journey")]
          : dataset.values.map((value) => md5(JSON.stringify(value)));

    return {
      generalSettingsHash,
      valueHashes,
    };
  }

  public static migrateFunnelSteps(
    steps: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return steps.map((s) => {
      if ("factTable" in s && !("factTableId" in s)) {
        const { factTable, ...rest } = s;
        return { ...rest, factTableId: factTable };
      }
      return s;
    });
  }

  protected migrate(legacyDoc: unknown): ProductAnalyticsExploration {
    const doc = { ...(legacyDoc as ProductAnalyticsExploration) };
    if (doc.config?.dataset?.type === "funnel") {
      const { dataset } = doc.config;
      if (dataset.steps.some((s) => !("factTableId" in s))) {
        dataset.steps = AnalyticsExplorationModel.migrateFunnelSteps(
          dataset.steps as unknown as Record<string, unknown>[],
        ) as typeof dataset.steps;
      }
    }
    return doc;
  }

  protected canRead(doc: ProductAnalyticsExploration): boolean {
    const { datasource } = this.getForeignRefs(doc);
    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects || [],
    );
  }
  protected canCreate(doc: ProductAnalyticsExploration): boolean {
    const { datasource } = this.getForeignRefs(doc);
    if (!datasource) return false;
    return this.context.permissions.canRunTestQueries(datasource);
  }
  protected canUpdate(existing: ProductAnalyticsExploration): boolean {
    return this.canCreate(existing);
  }
  protected canDelete(doc: ProductAnalyticsExploration): boolean {
    return this.canCreate(doc);
  }

  public async findLatestByConfig(
    config: ExplorationConfig,
    options?: { minUnusedLookahead?: number },
  ) {
    const { dataset } = config;
    if (!dataset) return null;

    const configHashes = this.getConfigHashes(config);
    if (!configHashes) return null;

    const query = {
      datasource: config.datasource,
      status: "success" as const,
      configHash: configHashes.generalSettingsHash,
      valueHashes: { $eq: configHashes.valueHashes },
    };
    const requestedJourney =
      config.dataset.type === "journey" ? config.dataset : null;

    // 1. Get all possible matches (ignoring date ranges for now)
    if (!requestedJourney) {
      const matches = await this._find(query, {
        sort: { dateCreated: -1 },
        limit: 5,
      });
      return this.pickBestDateRangeMatch(config, matches);
    }

    // Journeys look at many more candidates because a single result can serve a
    // whole family of paths. Decide from the configs alone first — result rows
    // run to MAX_JOURNEY_RESULT_ROWS each, so loading 40 of them to reject 39 on
    // a config mismatch is the expensive way to do it.
    const candidates = await this._find(query, {
      sort: { dateCreated: -1 },
      limit: JOURNEY_CACHE_CANDIDATE_LIMIT,
      projection: { result: 0 },
    });

    const needRows: string[] = [];
    const servable: typeof candidates = [];
    for (const candidate of candidates) {
      if (candidate.config.dataset.type !== "journey") continue;
      const verdict = journeyCacheCandidateVerdict({
        cachedDataset: candidate.config.dataset,
        requestedDataset: requestedJourney,
        minUnusedLookahead: options?.minUnusedLookahead,
      });
      if (verdict === "yes") servable.push(candidate);
      else if (verdict === "needs-rows") needRows.push(candidate.id);
    }

    if (needRows.length) {
      const withRows = await this._find({ id: { $in: needRows } });
      for (const match of withRows) {
        if (match.config.dataset.type !== "journey") continue;
        if (
          journeyResultCanServe({
            cachedDataset: match.config.dataset,
            cachedRows: match.result?.rows ?? [],
            requestedDataset: requestedJourney,
            minUnusedLookahead: options?.minUnusedLookahead,
          })
        ) {
          servable.push(match);
        }
      }
    }

    const best = this.pickBestDateRangeMatch(config, servable);
    // `servable` mixes rows-free candidates with fully loaded ones; re-read the
    // winner so the caller always gets a complete document.
    return best && !best.result ? await this.getById(best.id) : best;
  }

  private pickBestDateRangeMatch(
    config: ExplorationConfig,
    compatible: ProductAnalyticsExploration[],
  ) {
    const requestedDates = calculateProductAnalyticsDateRange(config.dateRange);

    // 2. Find the analysis that best matches the requested date range
    const bestMatch = compatible.reduce(
      (max, current) => {
        const requestedRange =
          requestedDates.endDate.getTime() - requestedDates.startDate.getTime();
        const currentRange =
          getValidDate(current.dateEnd).getTime() -
          getValidDate(current.dateStart).getTime();

        if (!requestedRange || !currentRange) {
          return max;
        }

        // Calculate overlap
        const maxStart = Math.max(
          requestedDates.startDate.getTime(),
          getValidDate(current.dateStart).getTime(),
        );
        const minEnd = Math.min(
          requestedDates.endDate.getTime(),
          getValidDate(current.dateEnd).getTime(),
        );
        const overlap = Math.max(0, minEnd - maxStart);

        // Calculate coverage
        // 1 = full coverage of requested date range, 0 = no coverage
        const coverage = overlap / requestedRange;

        // Calculate precision
        // 1 = no extra data outside of requested range, 0 = more data outside than inside requested range
        const precision = Math.max(
          0,
          1 - (currentRange - overlap) / requestedRange,
        );

        const score = coverage * precision;

        return score > max.score ? { analysis: current, score: score } : max;
      },
      { analysis: null, score: 0 } as {
        analysis: ProductAnalyticsExploration | null;
        score: number;
      },
    );

    // 3. Return if it's a good enough match
    // This is a balance between accurate results and cache hit rates (i.e. query costs)
    if (bestMatch.score >= 0.9) {
      return bestMatch.analysis;
    }

    return null;
  }

  protected async beforeCreate(
    doc: ProductAnalyticsExploration,
  ): Promise<void> {
    const configHashes = this.getConfigHashes(doc.config);
    if (!configHashes) return;
    doc.configHash = configHashes.generalSettingsHash;
    doc.valueHashes = configHashes.valueHashes;
  }

  public toApiInterface(exploration: ProductAnalyticsExploration) {
    return toApiInterface(exploration);
  }
}
