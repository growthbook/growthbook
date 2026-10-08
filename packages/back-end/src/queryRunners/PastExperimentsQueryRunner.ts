import { getValidDate } from "shared/dates";
import {
  getExposureQueryIdentifierTypes,
  getPreferredIdentifierType,
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
 * lookback: never run, its identifiers changed since, or it found nothing.
 */
export function getPastExperimentsWatermark(
  model: Pick<PastExperimentsInterface, "experiments" | "exposureQueryRuns">,
  exposureQueryId: string,
  identifierTypes: string[],
): Date | null {
  const run = model.exposureQueryRuns?.find(
    (r) => r.exposureQueryId === exposureQueryId,
  );
  if (
    !run ||
    !isEqual([...run.identifierTypes].sort(), [...identifierTypes].sort())
  ) {
    return null;
  }
  let watermark: Date | null = null;
  (model.experiments ?? []).forEach((e) => {
    if (e.exposureQueryId !== exposureQueryId) return;
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
  exposureQueryIds,
  runStarted,
}: {
  previous: Pick<PastExperimentsInterface, "experiments" | "exposureQueryRuns">;
  results: PastExperimentResult[];
  exposureQueryIds: string[];
  runStarted: Date;
}): PastExperimentsAnalysis {
  const current = new Set(exposureQueryIds);
  const previousRows = previous.experiments ?? [];

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
    runs.set(result.exposureQueryId, {
      exposureQueryId: result.exposureQueryId,
      identifierTypes: result.identifierTypes,
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
 * Rows discovered before every identifier was counted don't record theirs.
 * Discovery counted on the query's legacy `userIdType` while it was declared,
 * else its first declared identifier.
 */
export function withCountedIdentifierTypes(
  experiments: PastExperiment[],
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): PastExperiment[] {
  return experiments.map((e) => {
    if (e.identifierType) return e;
    const query = exposureQueries.find((q) => q.id === e.exposureQueryId);
    return query
      ? { ...e, identifierType: getPreferredIdentifierType(query) }
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
    for (const exposureQuery of this.getExposureQueries()) {
      const identifierTypes = getExposureQueryIdentifierTypes(exposureQuery);
      if (!identifierTypes.length) continue;
      const watermark = params.forceRefresh
        ? null
        : getPastExperimentsWatermark(
            this.model,
            exposureQuery.id,
            identifierTypes,
          );
      const from = watermark ?? params.from;
      queries.push(
        await this.startQuery({
          name: `experiments_${exposureQuery.id}`,
          query: this.integration.getPastExperimentQuery({
            exposureQuery,
            identifierTypes,
            from,
          }),
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
      exposureQueryIds: this.getExposureQueries().map((q) => q.id),
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
