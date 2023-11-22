import {
  ExperimentDimension,
  AutomaticDimensionInterface,
  AutomaticDimensionQueryResponseRows,
  AutomaticDimensionResult,
} from "../types/Integration";
import { Queries, QueryStatus } from "../../types/query";
import {
  getAutomaticDimensionById,
  updateAutomaticDimension,
} from "../models/AutomaticDimensionModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type AutomaticDimensionParams = {
  exposureQueryId: string;
};

export class AutomaticDimensionQueryRunner extends QueryRunner<
  AutomaticDimensionInterface,
  AutomaticDimensionParams,
  AutomaticDimensionResult[]
> {
  async startQueries(params: AutomaticDimensionParams): Promise<Queries> {
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
        name: "automaticdimensions",
        query: this.integration.getAutomaticDimensionQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions,
        }),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runAutomaticDimensionQuery(query, setExternalId),
        process: (rows) => rows,
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<AutomaticDimensionResult[]> {
    const automaticDimension = queryMap.get("automaticdimensions")
      ?.result as AutomaticDimensionQueryResponseRows;

    // Group by experiment and exposureQuery
    const dimValueMap = new Map<string, { name: string; percent: number }[]>();
    automaticDimension.forEach((d) => {
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

    const results: AutomaticDimensionResult[] = [];
    dimValueMap.forEach((dimValues, dimName) => {
      results.push({
        dimension: dimName,
        dimensionValues: dimValues,
      });
    });
    return results;
  }
  async getLatestModel(): Promise<AutomaticDimensionInterface> {
    const model = await getAutomaticDimensionById(
      this.model.organization,
      this.model.id
    );
    if (!model) throw new Error("Could not find automatic dimension model");
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
    result?: AutomaticDimensionResult[] | undefined;
    error?: string | undefined;
  }): Promise<AutomaticDimensionInterface> {
    return updateAutomaticDimension(this.model, {
      queries,
      runStarted,
      results,
      error,
    });
  }
}
