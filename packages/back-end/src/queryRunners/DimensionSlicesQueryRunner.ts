import {
  ExperimentDimension,
  DimensionSlicesQueryResponseRows,
} from "../types/Integration";
import {
  DimensionSlicesInterface,
  DimensionSlicesResult,
} from "../../types/dimension";
import { Queries } from "../../types/query";
import {
  getDimensionSlicesById,
  updateDimensionSlices,
} from "../models/DimensionSlicesModel";
import { QueryRunner, QueryMap } from "./QueryRunner";
export type DimensionSlicesParams = {
  exposureQueryId: string;
  lookbackDays: number;
};

export class DimensionSlicesQueryRunner extends QueryRunner<
  DimensionSlicesInterface,
  DimensionSlicesParams,
  DimensionSlicesResult[]
> {
  async startQueries(params: DimensionSlicesParams): Promise<Queries> {
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
      throw new Error(
        "Exposure query must have at least 1 dimension to get dimension slices."
      );
    }

    const labels = new Map<string, string>([
      ["organization", this.organization.id],
      ["datasource", this.integration.datasource],
      ["model_id", this.model.id],
      ["query_type", "dimensionSlices"],
    ]);

    return [
      await this.startQuery({
        name: "dimensionSlices",
        query: this.integration.getDimensionSlicesQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions,
          lookbackDays: params.lookbackDays,
        }),
        dependencies: [],
        labels: labels,
        run: (query, labels, setExternalId) =>
          this.integration.runDimensionSlicesQuery(
            query,
            labels,
            setExternalId
          ),
        process: (rows) => rows,
        queryType: "dimensionSlices",
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<DimensionSlicesResult[]> {
    const dimensionSlices = queryMap.get("dimensionSlices")
      ?.result as DimensionSlicesQueryResponseRows;

    // Group by experiment and exposureQuery
    const dimValueMap = new Map<string, { name: string; percent: number }[]>();
    dimensionSlices.forEach((d) => {
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

    const results: DimensionSlicesResult[] = [];
    dimValueMap.forEach((dimValues, dimName) => {
      results.push({
        dimension: dimName,
        dimensionSlices: dimValues,
      });
    });
    return results;
  }
  async getLatestModel(): Promise<DimensionSlicesInterface> {
    const model = await getDimensionSlicesById(
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
    result?: DimensionSlicesResult[] | undefined;
    error?: string | undefined;
  }): Promise<DimensionSlicesInterface> {
    return updateDimensionSlices(this.model, {
      queries,
      runStarted,
      results,
      error,
    });
  }
}
