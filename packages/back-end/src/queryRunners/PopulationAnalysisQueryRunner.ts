import {
  PopulationAnalysisInterface,
  PopulationMembershipResult,
} from "shared/validators";
import { FactTableMap } from "shared/types/fact-table";
import { Queries, QueryStatus } from "shared/types/query";
import { UpdateProps } from "shared/types/base-model";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { getPopulationMembershipPoints } from "back-end/src/integrations/sql/dates/population-membership-points";
import { processPopulationMembershipRows } from "back-end/src/integrations/sql/processing/process-population-membership-rows";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type PopulationAnalysisParams = {
  factTableMap: FactTableMap;
};

const QUERY_NAME = "populationMembership";

export class PopulationAnalysisQueryRunner extends QueryRunner<
  PopulationAnalysisInterface,
  PopulationAnalysisParams,
  PopulationMembershipResult
> {
  checkPermissions(): boolean {
    return this.context.permissions.canRunFactQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: PopulationAnalysisParams): Promise<Queries> {
    if (!(this.integration instanceof SqlIntegration)) {
      throw new Error("Populations only support SQL data sources");
    }

    const sql = this.integration.getPopulationMembershipQuery({
      steps: this.model.steps,
      userIdType: this.model.userIdType,
      factTableMap: params.factTableMap,
      points: getPopulationMembershipPoints(this.model.asOf),
    });
    const integration = this.integration;

    return [
      await this.startQuery({
        name: QUERY_NAME,
        displayTitle: "Population membership",
        query: sql,
        dependencies: [],
        run: (query, setExternalId, queryMetadata) =>
          integration.runPopulationMembershipQuery(
            query,
            setExternalId,
            queryMetadata,
          ),
        metadata: { factTableIds: Array.from(params.factTableMap.keys()) },
        queryType: "populationMembership",
      }),
    ];
  }

  async runAnalysis(queryMap: QueryMap): Promise<PopulationMembershipResult> {
    const rows = queryMap.get(QUERY_NAME)?.result;
    if (!rows) {
      throw new Error("Population membership query result not found");
    }
    return processPopulationMembershipRows(
      getPopulationMembershipPoints(this.model.asOf),
      rows as Record<string, unknown>[],
    );
  }

  async getLatestModel(): Promise<PopulationAnalysisInterface> {
    const model = await this.context.models.populationAnalyses.getById(
      this.model.id,
    );
    if (!model) {
      throw new Error("Population analysis not found");
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
    runStarted?: Date;
    result?: PopulationMembershipResult;
    error?: string;
  }): Promise<PopulationAnalysisInterface> {
    const updates: UpdateProps<PopulationAnalysisInterface> = {
      queries,
      error: error ?? null,
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
    return this.context.models.populationAnalyses.update(latest, updates);
  }
}
