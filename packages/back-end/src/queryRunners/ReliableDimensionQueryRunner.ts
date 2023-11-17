import { getValidDate } from "shared/dates";
import {
  ExperimentDimension,
  PastExperimentParams,
  PastExperimentResponseRows,
  PastExperimentResult,
  ReliableDimensionInterface,
  ReliableDimensionQueryResponseRows,
  ReliableDimensionResult,
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
import { getReliableDimensionById, updateReliableDimension } from "../models/ReliableDimensionModel";

export type ReliableDimensionParams = {
  exposureQueryId: string
};

export class ReliableDimensionQueryRunner extends QueryRunner<
  ReliableDimensionInterface,
  ReliableDimensionParams,
  ReliableDimensionResult[]
> {
  async startQueries(params: ReliableDimensionParams): Promise<Queries> {
    
    const exposureQuery = (this.integration.settings?.queries?.exposure || []).find(
      (q) => q.id === params.exposureQueryId
    );
  
    const dimensions: ExperimentDimension[] = (exposureQuery?.dimensions || []).map((id) => ({
      type: "experiment",
      id,
    }));

    return [
      await this.startQuery({
        name: "reliabledimensions",
        query: this.integration.getReliableDimensionQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions
        }),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runReliableDimensionQuery(query, setExternalId),
        process: (rows) => rows,
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<ReliableDimensionResult[]> {
    const reliableDimension =
      (queryMap.get("reliabledimensions")?.result as ReliableDimensionQueryResponseRows);

    // Group by experiment and exposureQuery
    const dimValueMap = new Map<string, string[]>();
    reliableDimension.forEach((d) => {
      const dimArray = dimValueMap.get(d.dimension_name);
      if (dimArray) {
        dimArray.push(d.dimension_value);
      } else {
        dimValueMap.set(d.dimension_name, [d.dimension_value])
      }
    });
    
    const results: ReliableDimensionResult[] = [];
    dimValueMap.forEach((dimValues, dimName) => {
      results.push({
        dimension: dimName,
        dimensionValues: dimValues,
        sql: this.integration.getDimensionInStatement(dimName, dimValues)
      })
    })
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
