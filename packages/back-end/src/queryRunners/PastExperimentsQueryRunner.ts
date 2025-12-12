import { getValidDate } from "shared/dates";
import {
  PastExperimentParams,
  PastExperimentResponseRows,
  PastExperimentResult,
} from "shared/types/integrations";
import {
  PastExperiment,
  PastExperimentsInterface,
} from "back-end/types/past-experiments";
import { Queries, QueryStatus } from "back-end/types/query";
import {
  getPastExperimentsById,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class PastExperimentsQueryRunner extends QueryRunner<
  PastExperimentsInterface,
  PastExperimentParams,
  PastExperiment[]
> {
  checkPermissions(): boolean {
    return this.context.permissions.canRunPastExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: PastExperimentParams): Promise<Queries> {
    let merge = false;
    if (!params.forceRefresh && this.model.latestData) {
      params.from = this.model.latestData;
      merge = true;
    }

    return [
      await this.startQuery({
        name: "experiments",
        query: this.integration.getPastExperimentQuery(params),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runPastExperimentQuery(query, setExternalId),
        process: (rows) =>
          this.processPastExperimentQueryResponse(rows, merge, params.from),
        queryType: "pastExperiment",
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<PastExperiment[]> {
    const queryResults = queryMap.get("experiments")?.result as
      | PastExperimentResult
      | undefined;

    const shouldMerge = queryResults?.mergeResults || false;

    // Group by experiment and exposureQuery
    const experimentMap = new Map<string, PastExperiment>();

    if (shouldMerge) {
      this.model.experiments?.forEach((e) => {
        const key = e.trackingKey + "::" + e.exposureQueryId;
        experimentMap.set(key, e);
      });
    }

    const experiments = queryResults?.experiments || [];

    experiments.forEach((e) => {
      const key = e.experiment_id + "::" + e.exposureQueryId;
      let el = experimentMap.get(key);
      if (!el) {
        el = {
          endDate: e.end_date,
          startDate: e.start_date,
          numVariations: 1,
          variationKeys: [e.variation_id],
          variationNames: [e.variation_name || ""],
          exposureQueryId: e.exposureQueryId || "",
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
        if (
          !el.latestData ||
          (e.latest_data && e.latest_data > el.latestData)
        ) {
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
      const newTotalWeight = exp.weights.reduce(
        (sum, weight) => sum + weight,
        0,
      );
      if (newTotalWeight < 100) {
        exp.weights[0] += 100 - newTotalWeight;
      }
      exp.weights = exp.weights.map((w) => w / 100);
    });

    return Array.from(experimentMap.values());
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
    result: experiments,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: PastExperiment[] | undefined;
    error?: string | undefined;
  }): Promise<PastExperimentsInterface> {
    let latestData: Date | undefined = undefined;
    experiments?.forEach((row) => {
      const d = row.latestData || row.endDate;
      if (!latestData || d > latestData) {
        latestData = d;
      }
    });

    return updatePastExperiments(this.model, {
      queries,
      runStarted,
      experiments,
      latestData,
      error,
    });
  }
  private processPastExperimentQueryResponse(
    rows: PastExperimentResponseRows,
    merge: boolean,
    from: Date,
  ): PastExperimentResult {
    const fromBuffer = new Date(from);
    fromBuffer.setDate(fromBuffer.getDate() + 2);

    return {
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
