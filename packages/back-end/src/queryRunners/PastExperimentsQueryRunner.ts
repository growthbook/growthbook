import { getValidDate } from "shared/dates";
import {
  getExposureQueryIdentifierTypes,
  getPastExperimentQueryName,
} from "shared/util";
import { ExposureQuery } from "shared/types/datasource";
import {
  PastExperimentParams,
  PastExperimentResponseRows,
  PastExperimentResult,
} from "shared/types/integrations";
import {
  PastExperiment,
  PastExperimentsInterface,
  PastExperimentsQueryRun,
} from "shared/types/past-experiments";
import { Queries, QueryStatus } from "shared/types/query";
import cloneDeep from "lodash/cloneDeep";
import isEqual from "lodash/isEqual";
import {
  getPastExperimentsById,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type PastExperimentsAnalysis = Required<
  Pick<PastExperimentsInterface, "experiments" | "exposureQueryRuns">
>;

/**
 * Where an assignment query's discovery continues from, or null for a full
 * lookback: some identifier it declares wasn't counted, or it found nothing.
 * Rows should already be labeled by `withCountedIdentifierTypes`.
 */
export function getPastExperimentsWatermark(
  model: Pick<PastExperimentsInterface, "experiments" | "exposureQueryRuns">,
  exposureQueryId: string,
  identifierTypes: string[],
): Date | null {
  const rows = (model.experiments ?? []).filter(
    (e) => e.exposureQueryId === exposureQueryId,
  );
  const run = model.exposureQueryRuns?.find(
    (r) => r.exposureQueryId === exposureQueryId,
  );
  // Before per-query discovery nothing was recorded; the rows' labels say
  // what was counted, so a query with only its legacy identifier continues.
  const counted = run
    ? run.identifierTypes
    : rows.every((e) => e.identifierType)
      ? [...new Set(rows.map((e) => e.identifierType as string))]
      : [];
  if (!isEqual([...counted].sort(), [...identifierTypes].sort())) {
    return null;
  }
  let watermark: Date | null = null;
  rows.forEach((e) => {
    const d = e.latestData || e.endDate;
    if (!watermark || d > watermark) watermark = d;
  });
  return watermark;
}

/**
 * Applies a run's results per assignment query. Queries that didn't run (or
 * failed) keep their rows and state; queries no longer on the data source lose
 * both.
 */
export function mergePastExperimentResults({
  previous,
  results,
  exposureQueries,
  runStarted,
}: {
  previous: Pick<
    PastExperimentsInterface,
    "experiments" | "exposureQueryRuns" | "config"
  >;
  results: PastExperimentResult[];
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[];
  runStarted: Date;
}): PastExperimentsAnalysis {
  const current = new Set(exposureQueries.map((q) => q.id));
  // Labeled so an incremental run merges into rows from before identifiers
  // were recorded instead of keying them separately.
  const previousRows = withCountedIdentifierTypes(
    previous.experiments ?? [],
    exposureQueries,
  );

  const ran = new Set<string>();
  const merged: PastExperiment[] = [];
  results.forEach((result) => {
    // Results from before per-query discovery cover several queries.
    const ids = result.exposureQueryId
      ? [result.exposureQueryId]
      : [...new Set(result.experiments.map((e) => e.exposureQueryId))];
    ids.forEach((id) => ran.add(id));
    const base = result.mergeResults
      ? previousRows.filter((e) => ids.includes(e.exposureQueryId))
      : [];
    merged.push(...aggregatePastExperiments(base, result));
  });

  const experiments = [
    ...previousRows.filter((e) => !ran.has(e.exposureQueryId)),
    ...merged,
  ].filter((e) => current.has(e.exposureQueryId));

  const runs = new Map<string, PastExperimentsQueryRun>();
  (previous.exposureQueryRuns ?? []).forEach((r) =>
    runs.set(r.exposureQueryId, r),
  );
  results.forEach((result) => {
    if (!result.exposureQueryId || !result.identifierTypes) return;
    // An incremental run keeps the rows' start. Rows from before per-query
    // discovery go back to the record's start.
    const start = result.mergeResults
      ? (runs.get(result.exposureQueryId)?.start ?? previous.config?.start)
      : result.from;
    if (!start) return;
    runs.set(result.exposureQueryId, {
      exposureQueryId: result.exposureQueryId,
      identifierTypes: result.identifierTypes,
      start: getValidDate(start),
      lastRunAt: runStarted,
    });
  });

  return {
    experiments,
    exposureQueryRuns: [...runs.values()].filter((r) =>
      current.has(r.exposureQueryId),
    ),
  };
}

/**
 * Each query covers its own assignment query, so a run only fails if they all
 * do. Otherwise the successes are saved and failed queries keep their rows.
 */
export function rollupPastExperimentQueryStatus(queries: Queries): QueryStatus {
  if (queries.some((q) => q.status === "running" || q.status === "queued")) {
    return "running";
  }
  const failed = queries.filter((q) => q.status === "failed").length;
  if (failed === queries.length) return "failed";
  return failed ? "partially-succeeded" : "succeeded";
}

/**
 * Rows discovered before every identifier was counted don't record theirs.
 * Discovery counted on the query's legacy `userIdType` while the query declared
 * it. Once it doesn't, the counts may be on an identifier that's gone, so the
 * row stays unlabeled (and out of the import table) until the next refresh.
 */
export function withCountedIdentifierTypes(
  experiments: PastExperiment[],
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): PastExperiment[] {
  return experiments.map((e) => {
    if (e.identifierType) return e;
    const query = exposureQueries.find((q) => q.id === e.exposureQueryId);
    return query &&
      getExposureQueryIdentifierTypes(query).includes(query.userIdType)
      ? { ...e, identifierType: query.userIdType }
      : e;
  });
}

function getMergeReadyWeights(exp: PastExperiment): number[] {
  // Stored weights are normalized fractions (e.g. [0.5, 0.5]) after each run.
  // Convert those back to count-space before merging in new user counts.
  if (!exp.weights?.length) return [];
  const maxWeight = Math.max(...exp.weights);
  if (maxWeight <= 1) {
    return exp.weights.map((w) => w * exp.users);
  }
  return [...exp.weights];
}

function aggregatePastExperiments(
  base: PastExperiment[],
  result: PastExperimentResult,
): PastExperiment[] {
  const experimentMap = new Map<string, PastExperiment>();
  const getKey = (
    trackingKey: string,
    exposureQueryId: string,
    identifierType: string | undefined,
  ) => `${trackingKey}::${exposureQueryId}::${identifierType ?? ""}`;

  base.forEach((e) => {
    const key = getKey(e.trackingKey, e.exposureQueryId, e.identifierType);
    const mergeBase = cloneDeep(e);
    mergeBase.weights = getMergeReadyWeights(e);
    experimentMap.set(key, mergeBase);
  });

  result.experiments.forEach((e) => {
    const key = getKey(e.experiment_id, e.exposureQueryId, e.identifierType);
    let el = experimentMap.get(key);
    if (!el) {
      el = {
        endDate: e.end_date,
        startDate: e.start_date,
        numVariations: 1,
        variationKeys: [e.variation_id],
        variationNames: [e.variation_name || ""],
        exposureQueryId: e.exposureQueryId || "",
        identifierType: e.identifierType,
        trackingKey: e.experiment_id,
        experimentName: e.experiment_name,
        users: e.users,
        weights: [e.users],
        latestData: e.latest_data,
        startOfRange: e.start_of_range,
      };
      experimentMap.set(key, el);
    } else {
      if (e.start_date < el.startDate) {
        el.startDate = e.start_date;
      }
      if (e.end_date > el.endDate) {
        el.endDate = e.end_date;
      }
      if (!el.latestData || (e.latest_data && e.latest_data > el.latestData)) {
        el.latestData = e.latest_data;
      }
      if (!el.variationKeys.includes(e.variation_id)) {
        el.variationKeys.push(e.variation_id);
        el.variationNames?.push(e.variation_name || "");
        el.weights.push(0);
        el.numVariations++;
      }

      el.users += e.users;

      const idx = el.variationKeys.indexOf(e.variation_id);
      if (idx >= 0) {
        el.weights[idx] += e.users;
      }
    }
  });

  // Round the weights
  const possibleWeights = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 16, 20, 25, 30, 33, 40, 45, 50, 55,
    60, 67, 70, 75, 80, 85, 90, 95, 96, 97, 98, 99,
  ];
  experimentMap.forEach((exp) => {
    const totalWeight = exp.weights.reduce((sum, weight) => sum + weight, 0);
    exp.weights = exp.weights.map((w) => {
      // Map the observed percentage traffic to the closest reasonable number
      const p = Math.round((w / totalWeight) * 100);
      const closestWeight = possibleWeights
        .map((x) => [x, Math.abs(x - p)])
        .sort((a, b) => a[1] - b[1])[0][0];
      // bias towards 50/50 if the weight is 45 or 55
      if (closestWeight === 45) {
        if (p <= 46) {
          return 45;
        } else {
          return 50;
        }
      }
      if (closestWeight === 55) {
        if (p >= 54) {
          return 55;
        } else {
          return 50;
        }
      }
      return closestWeight;
    });

    // Make sure total weight adds to 1 (if not, increase the control until it does)
    const newTotalWeight = exp.weights.reduce((sum, weight) => sum + weight, 0);
    if (newTotalWeight < 100) {
      exp.weights[0] += 100 - newTotalWeight;
    }
    exp.weights = exp.weights.map((w) => w / 100);
  });

  return Array.from(experimentMap.values());
}

export class PastExperimentsQueryRunner extends QueryRunner<
  PastExperimentsInterface,
  PastExperimentParams,
  PastExperimentsAnalysis
> {
  protected override getOverallQueryStatus(): QueryStatus {
    return rollupPastExperimentQueryStatus(this.model.queries);
  }

  checkPermissions(): boolean {
    return this.context.permissions.canRunPastExperimentQueries(
      this.integration.datasource,
    );
  }

  private getExposureQueries() {
    return this.integration.datasource.settings?.queries?.exposure ?? [];
  }

  async startQueries(params: PastExperimentParams): Promise<Queries> {
    const queries: Queries = [];
    const { datasource } = this.integration;
    // Queries the user can't run keep their rows and state as they were.
    const runnable = this.getExposureQueries().filter((q) =>
      this.context.permissions.canRunPastExperimentQuery(q, datasource),
    );
    const model = {
      ...this.model,
      experiments: withCountedIdentifierTypes(
        this.model.experiments ?? [],
        this.getExposureQueries(),
      ),
    };
    // All SQL is built before any query starts: a template that fails to
    // compile would otherwise leave earlier warehouse jobs running untracked.
    const planned = runnable.flatMap((exposureQuery) => {
      const identifierTypes = getExposureQueryIdentifierTypes(exposureQuery);
      if (!identifierTypes.length) return [];
      const watermark = params.forceRefresh
        ? null
        : getPastExperimentsWatermark(model, exposureQuery.id, identifierTypes);
      const from = watermark ?? params.from;
      const sql = this.integration.getPastExperimentQuery({
        exposureQuery,
        identifierTypes,
        from,
      });
      return [{ exposureQuery, identifierTypes, watermark, from, sql }];
    });
    for (const {
      exposureQuery,
      identifierTypes,
      watermark,
      from,
      sql,
    } of planned) {
      queries.push(
        await this.startQuery({
          name: getPastExperimentQueryName(exposureQuery.id),
          query: sql,
          dependencies: [],
          run: (query, setExternalId, queryMetadata) =>
            this.integration.runPastExperimentQuery(
              query,
              setExternalId,
              queryMetadata,
            ),
          process: (rows) =>
            this.processPastExperimentQueryResponse(rows, {
              exposureQueryId: exposureQuery.id,
              identifierTypes,
              merge: !!watermark,
              from,
            }),
          queryType: "pastExperiment",
        }),
      );
    }
    return queries;
  }

  async runAnalysis(queryMap: QueryMap): Promise<PastExperimentsAnalysis> {
    const results: PastExperimentResult[] = [];
    queryMap.forEach((query) => {
      // Failed queries have no result; their rows are kept as they were.
      if (query.result) results.push(query.result as PastExperimentResult);
    });

    return mergePastExperimentResults({
      previous: this.model,
      results,
      exposureQueries: this.getExposureQueries(),
      runStarted: this.model.runStarted ?? new Date(),
    });
  }

  async getLatestModel(): Promise<PastExperimentsInterface> {
    const model = await getPastExperimentsById(
      this.model.organization,
      this.model.id,
    );
    if (!model) throw new Error("Could not find past experiments model");
    return model;
  }

  async updateModel({
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: PastExperimentsAnalysis | undefined;
    error?: string | undefined;
  }): Promise<PastExperimentsInterface> {
    const changes: Partial<PastExperimentsInterface> = {
      queries,
      runStarted,
      error,
    };
    if (result) {
      let latestData: Date | undefined = undefined;
      result.experiments.forEach((row) => {
        const d = row.latestData || row.endDate;
        if (!latestData || d > latestData) {
          latestData = d;
        }
      });
      changes.experiments = result.experiments;
      changes.exposureQueryRuns = result.exposureQueryRuns;
      changes.latestData = latestData;
    }

    return updatePastExperiments(this.model, changes);
  }

  private processPastExperimentQueryResponse(
    rows: PastExperimentResponseRows,
    {
      exposureQueryId,
      identifierTypes,
      merge,
      from,
    }: {
      exposureQueryId: string;
      identifierTypes: string[];
      merge: boolean;
      from: Date;
    },
  ): PastExperimentResult {
    const fromBuffer = new Date(from);
    fromBuffer.setDate(fromBuffer.getDate() + 2);

    return {
      exposureQueryId,
      identifierTypes,
      from,
      mergeResults: merge,
      experiments: rows.map((row) => {
        const startDate = getValidDate(row.start_date);

        let startOfRange = false;
        if (!merge) {
          if (startDate < fromBuffer) {
            startOfRange = true;
          }
        }
        return {
          exposureQueryId: row.exposure_query,
          identifierType: row.identifier_type,
          users: row.users,
          experiment_id: row.experiment_id,
          experiment_name: row.experiment_name,
          variation_id: row.variation_id,
          variation_name: row.variation_name,
          end_date: getValidDate(row.end_date),
          start_date: startDate,
          latest_data: getValidDate(row.latest_data),
          start_of_range: startOfRange,
        };
      }),
    };
  }
}
