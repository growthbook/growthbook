import {
  ExperimentDimension,
  ReliableDimensionInterface,
  ReliableDimensionQueryResponseRows,
  ReliableDimensionResult,
} from "../types/Integration";
import { Queries, QueryStatus } from "../../types/query";
import {
  getReliableDimensionById,
  updateReliableDimension,
} from "../models/ReliableDimensionModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type ReliableDimensionParams = {
  exposureQueryId: string;
};

export class ReliableDimensionQueryRunner extends QueryRunner<
  ReliableDimensionInterface,
  ReliableDimensionParams,
  ReliableDimensionResult[]
> {
  async startQueries(params: ReliableDimensionParams): Promise<Queries> {
    const exposureQuery = (
      this.integration.settings?.queries?.exposure || []
    ).find((q) => q.id === params.exposureQueryId);

    const dimensions: ExperimentDimension[] = (
      exposureQuery?.dimensions || []
    ).map((id) => ({
      type: "experiment",
      id,
    }));

    return [
      await this.startQuery({
        name: "reliabledimensions",
        query: this.integration.getReliableDimensionQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions,
        }),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runReliableDimensionQuery(query, setExternalId),
        process: (rows) => rows,
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<ReliableDimensionResult[]> {
    const reliableDimension = queryMap.get("reliabledimensions")
      ?.result as ReliableDimensionQueryResponseRows;

    // Group by experiment and exposureQuery
    const dimValueMap = new Map<string, { name: string; percent: number }[]>();
    reliableDimension.forEach((d) => {
      const dimName = d.dimension_name.replace("dim_exp_", "");
      const dimArray = dimValueMap.get(dimName);
      if (dimArray) {
        dimArray.push({ name: d.dimension_value, percent: d.percent });
      } else {
        dimValueMap.set(dimName, [
          { name: d.dimension_value, percent: d.percent },
        ]);
      }
    });

    const results: ReliableDimensionResult[] = [];
    dimValueMap.forEach((dimValues, dimName) => {
      results.push({
        dimension: dimName,
        dimensionValues: dimValues,
      });
    });
    return results;
  }
  async getLatestModel(): Promise<ReliableDimensionInterface> {
    const model = await getReliableDimensionById(
      this.model.organization,
      this.model.id
    );
    if (!model) throw new Error("Could not find reliable dimension model");
    return model;
  }
  async updateModel({
    queries,
    runStarted,
    result: results,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: ReliableDimensionResult[] | undefined;
    error?: string | undefined;
  }): Promise<ReliableDimensionInterface> {
    return updateReliableDimension(this.model, {
      queries,
      runStarted,
      results,
      error,
    });
  }
}
