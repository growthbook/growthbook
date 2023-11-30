import {
  ExperimentDimension,
  AutomaticDimensionInterface,
  AutomaticDimensionQueryResponseRows,
  AutomaticDimensionResult,
} from "../types/Integration";
import { Queries } from "../../types/query";
import {
  getAutomaticDimensionById,
  updateAutomaticDimension,
} from "../models/AutomaticDimensionModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type AutomaticDimensionParams = {
  exposureQueryId: string;
  lookbackDays: number;
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

    if (!dimensions.length) {
      throw new Error("Exposure query must have at least 1 dimension.");
    }

    return [
      await this.startQuery({
        name: "automaticdimensions",
        query: this.integration.getAutomaticDimensionQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions,
          lookbackDays: params.lookbackDays,
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
      const dimName = d.dimension_name.replace(/^dim_exp_/g, "");
      const dimArray = dimValueMap.get(dimName);
      if (dimArray) {
        dimArray.push({
          name: d.dimension_value,
          percent: 100.0 * (d.units / d.total_units),
        });
      } else {
        dimValueMap.set(dimName, [
          {
            name: d.dimension_value,
            percent: 100.0 * (d.units / d.total_units),
          },
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
