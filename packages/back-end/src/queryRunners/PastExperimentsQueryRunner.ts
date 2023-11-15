import { getValidDate } from "shared/dates";
import {
  PastExperimentParams,
  PastExperimentResponseRows,
  PastExperimentResult,
} from "../types/Integration";
import {
  PastExperiment,
  PastExperimentsInterface,
} from "../../types/past-experiments";
import { Queries, QueryStatus } from "../../types/query";
import {
  getPastExperimentsById,
  updatePastExperiments,
} from "../models/PastExperimentsModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export class PastExperimentsQueryRunner extends QueryRunner<
  PastExperimentsInterface,
  PastExperimentParams,
  PastExperiment[]
> {
  async startQueries(params: PastExperimentParams): Promise<Queries> {
    return [
      await this.startQuery({
        name: "experiments",
        query: this.integration.getPastExperimentQuery(params),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runPastExperimentQuery(query, setExternalId),
        process: (rows) => this.processPastExperimentQueryResponse(rows),
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<PastExperiment[]> {
    const experiments =
      (queryMap.get("experiments")?.result as PastExperimentResult)
        ?.experiments || [];

    // Group by experiment and exposureQuery
    const experimentExposureMap = new Map<string, PastExperiment>();
    experiments.forEach((e) => {
      const key = e.experiment_id + "::" + e.exposureQueryId;
      let el = experimentExposureMap.get(key);
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
        };
        experimentExposureMap.set(key, el);
      } else {
        if (e.start_date < el.startDate) {
          el.startDate = e.start_date;
        }
        if (e.end_date > el.endDate) {
          el.endDate = e.end_date;
        }
        if (!el.variationKeys.includes(e.variation_id)) {
          el.variationKeys.push(e.variation_id);
          el.weights.push(e.users);
          el.users += e.users;
          el.numVariations++;
          el.variationNames?.push(e.variation_name || "");
        }
      }
    });

    // Group by experiment, choosing the exposure query with the most users
    const experimentMap = new Map<string, PastExperiment>();
    experimentExposureMap.forEach((exp) => {
      const key = exp.trackingKey;
      const el = experimentMap.get(key);
      if (!el || el.users < exp.users) {
        experimentMap.set(key, exp);
      }
    });

    // Round the weights
    const possibleWeights = [
      5,
      10,
      16,
      20,
      25,
      30,
      33,
      40,
      50,
      60,
      67,
      70,
      75,
      80,
      90,
      95,
    ];
    experimentMap.forEach((exp) => {
      const totalWeight = exp.weights.reduce((sum, weight) => sum + weight, 0);
      exp.weights = exp.weights.map((w) => {
        // Map the observed percentage traffic to the closest reasonable number
        const p = Math.round((w / totalWeight) * 100);
        return possibleWeights
          .map((x) => [x, Math.abs(x - p)])
          .sort((a, b) => a[1] - b[1])[0][0];
      });

      // Make sure total weight adds to 1 (if not, increase the control until it does)
      const newTotalWeight = exp.weights.reduce(
        (sum, weight) => sum + weight,
        0
      );
      if (newTotalWeight < 100) {
        exp.weights[0] += 100 - newTotalWeight;
      }
      exp.weights = exp.weights.map((w) => w / 100);
    });

    // Filter out experiments with too few or too many variations
    return Array.from(experimentMap.values()).filter(
      (e) => e.numVariations > 1 && e.numVariations < 10
    );
  }
  async getLatestModel(): Promise<PastExperimentsInterface> {
    const model = await getPastExperimentsById(
      this.model.organization,
      this.model.id
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
    return updatePastExperiments(this.model, {
      queries,
      runStarted,
      experiments,
      error,
    });
  }
  private processPastExperimentQueryResponse(
    rows: PastExperimentResponseRows
  ): PastExperimentResult {
    return {
      experiments: rows.map((row) => {
        return {
          exposureQueryId: row.exposure_query,
          users: row.users,
          experiment_id: row.experiment_id,
          experiment_name: row.experiment_name,
          variation_id: row.variation_id,
          variation_name: row.variation_name,
          end_date: getValidDate(row.end_date),
          start_date: getValidDate(row.start_date),
        };
      }),
    };
  }
}
