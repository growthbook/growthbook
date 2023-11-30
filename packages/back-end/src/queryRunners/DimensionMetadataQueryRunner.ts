import {
  ExperimentDimension,
  DimensionMetadataInterface,
  DimensionMetadataQueryResponseRows,
  DimensionMetadataResult,
} from "../types/Integration";
import { Queries } from "../../types/query";
import {
  getDimensionMetadataById,
  updateDimensionMetadata,
} from "../models/DimensionMetadataModel";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type DimensionMetadataParams = {
  exposureQueryId: string;
  lookbackDays: number;
};

export class DimensionMetadataQueryRunner extends QueryRunner<
  DimensionMetadataInterface,
  DimensionMetadataParams,
  DimensionMetadataResult[]
> {
  async startQueries(params: DimensionMetadataParams): Promise<Queries> {
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
        name: "dimensionMetadata",
        query: this.integration.getDimensionMetadataQuery({
          exposureQueryId: params.exposureQueryId,
          dimensions: dimensions,
          lookbackDays: params.lookbackDays,
        }),
        dependencies: [],
        run: (query, setExternalId) =>
          this.integration.runDimensionMetadataQuery(query, setExternalId),
        process: (rows) => rows,
      }),
    ];
  }
  async runAnalysis(queryMap: QueryMap): Promise<DimensionMetadataResult[]> {
    const dimensionMetadata = queryMap.get("dimensionMetadata")
      ?.result as DimensionMetadataQueryResponseRows;

    // Group by experiment and exposureQuery
    const dimValueMap = new Map<string, { name: string; percent: number }[]>();
    dimensionMetadata.forEach((d) => {
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

    const results: DimensionMetadataResult[] = [];
    dimValueMap.forEach((dimValues, dimName) => {
      results.push({
        dimension: dimName,
        dimensionValues: dimValues,
      });
    });
    return results;
  }
  async getLatestModel(): Promise<DimensionMetadataInterface> {
    const model = await getDimensionMetadataById(
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
    result?: DimensionMetadataResult[] | undefined;
    error?: string | undefined;
  }): Promise<DimensionMetadataInterface> {
    return updateDimensionMetadata(this.model, {
      queries,
      runStarted,
      results,
      error,
    });
  }
}
