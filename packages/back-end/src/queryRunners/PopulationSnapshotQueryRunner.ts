import { UpdateProps } from "shared/types/base-model";
import { FactTableMap } from "shared/types/fact-table";
import { Queries, QueryStatus } from "shared/types/query";
import {
  PopulationInterface,
  PopulationSnapshotInterface,
  PopulationSnapshotResult,
} from "shared/validators";
import { parsePopulationSnapshotRows } from "shared/populations";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { QueryMap, QueryRunner } from "./QueryRunner";

export type PopulationSnapshotQueryParams = {
  population: PopulationInterface;
  factTableMap: FactTableMap;
};

export class PopulationSnapshotQueryRunner extends QueryRunner<
  PopulationSnapshotInterface,
  PopulationSnapshotQueryParams,
  PopulationSnapshotResult
> {
  checkPermissions(): boolean {
    return this.context.permissions.canRunFactQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: PopulationSnapshotQueryParams): Promise<Queries> {
    if (!(this.integration instanceof SqlIntegration)) {
      throw new Error("Populations only support SQL Data Sources");
    }
    const integration = this.integration;
    return [
      await this.startQuery({
        name: "population",
        query: integration.getPopulationQuery({
          steps: params.population.steps,
          userIdType: this.model.userIdType,
          factTableMap: params.factTableMap,
          asOf: this.model.asOf,
          comparisonDays: this.model.comparisonDays,
        }),
        dependencies: [],
        run: (query, setExternalId, queryMetadata) =>
          integration.runPopulationQuery(query, setExternalId, queryMetadata),
        queryType: "population",
      }),
    ];
  }

  async runAnalysis(queryMap: QueryMap): Promise<PopulationSnapshotResult> {
    const rows = queryMap.get("population")?.result as
      | Record<string, unknown>[]
      | undefined;
    if (!rows) {
      throw new Error("Population query result not found");
    }
    return parsePopulationSnapshotRows(rows);
  }

  async getLatestModel(): Promise<PopulationSnapshotInterface> {
    const model = await this.context.models.populationSnapshots.getById(
      this.model.id,
    );
    if (!model) {
      throw new Error("Population snapshot not found");
    }
    return model;
  }

  async updateModel({
    status,
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: PopulationSnapshotResult | undefined;
    error?: string | undefined;
  }): Promise<PopulationSnapshotInterface> {
    const updates: UpdateProps<PopulationSnapshotInterface> = {
      queries,
      error,
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };
    if (result) updates.result = result;
    if (runStarted) updates.runStarted = runStarted;

    const latest = await this.getLatestModel();
    return this.context.models.populationSnapshots.update(latest, updates);
  }
}
