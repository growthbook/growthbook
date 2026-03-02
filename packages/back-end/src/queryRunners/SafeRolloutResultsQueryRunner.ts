import { ExperimentMetricInterface } from "shared/experiments";
import { omit } from "lodash";
import { ExperimentAggregateUnitsQueryResponseRows } from "shared/types/integrations";
import { Queries, QueryStatus } from "shared/types/query";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotHealth,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { getSnapshotSettingsFromSafeRolloutArgs } from "back-end/src/services/safeRolloutSnapshots";
import {
  analyzeExperimentResults,
  analyzeExperimentTraffic,
} from "back-end/src/services/stats";
import { logger } from "back-end/src/util/logger";
import { QueryRunner, QueryMap } from "./QueryRunner";
import {
  ExperimentResultsQueryParams,
  startExperimentResultQueries,
  TRAFFIC_QUERY_NAME,
} from "./ExperimentResultsQueryRunner";

export type SafeRolloutSnapshotResult = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: SafeRolloutSnapshotAnalysis[];
  health?: SafeRolloutSnapshotHealth;
};

export type SafeRolloutQueryParams = {
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
};

export class SafeRolloutResultsQueryRunner extends QueryRunner<
  SafeRolloutSnapshotInterface,
  SafeRolloutQueryParams,
  SafeRolloutSnapshotResult
> {
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  // TODO: Decide if we want more granular permissions here for safe rollouts
  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: SafeRolloutQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;

    const { snapshotSettings } = getSnapshotSettingsFromSafeRolloutArgs(
      this.model,
    );

    const experimentParams: ExperimentResultsQueryParams = {
      snapshotType: "standard",
      metricMap: params.metricMap,
      snapshotSettings,
      variationNames: ["control", "variation"],
      queryParentId: this.model.id,
      factTableMap: params.factTableMap,
      experimentQueryMetadata: null,
    };

    return startExperimentResultQueries(
      this.context,
      experimentParams,
      this.integration,
      this.startQuery.bind(this),
    );
  }

  async runAnalysis(queryMap: QueryMap): Promise<SafeRolloutSnapshotResult> {
    const { snapshotSettings, analysisSettings } =
      getSnapshotSettingsFromSafeRolloutArgs(this.model);

    const { results: analysesResults } = await analyzeExperimentResults({
      queryData: queryMap,
      snapshotSettings: snapshotSettings,
      analysisSettings: [analysisSettings],
      variationNames: ["control", "variation"],
      metricMap: this.metricMap,
    });

    const result: SafeRolloutSnapshotResult = {
      analyses: this.model.analyses,
      multipleExposures: 0,
      unknownVariations: [],
    };

    analysesResults.forEach((results, i) => {
      const analysis = this.model.analyses[i];
      if (!analysis) return;

      analysis.results = results.dimensions || [];
      analysis.status = "success";
      analysis.error = "";

      // TODO: do this once, not per analysis
      result.unknownVariations = results.unknownVariations || [];
      result.multipleExposures = results.multipleExposures ?? 0;

      // Clear out any 'None' error messages from Python and standardize on undefined
      analysis.results.forEach((dimension) => {
        dimension.variations.forEach((variation) => {
          Object.values(variation.metrics).forEach((metric) => {
            if (metric.errorMessage === null || metric.errorMessage === "") {
              metric.errorMessage = undefined;
            }
            if (metric.power === null) {
              metric.power = undefined;
            }
          });
        });
      });
    });

    // Run health checks
    const healthQuery = queryMap.get(TRAFFIC_QUERY_NAME);
    if (healthQuery) {
      const rows =
        healthQuery.result as ExperimentAggregateUnitsQueryResponseRows;
      const trafficHealth = analyzeExperimentTraffic({
        rows: rows,
        error: healthQuery.error,
        variations: this.model.settings.variations,
      });

      result.health = {
        traffic: trafficHealth,
      };
    }
    // TODO: Add functionality to dynamically update coverage here
    return result;
  }

  async getLatestModel(): Promise<SafeRolloutSnapshotInterface> {
    const obj = await this.context.models.safeRolloutSnapshots.getById(
      this.model.id,
    );
    if (!obj) throw new Error("Could not load safe rollout snapshot model");
    return obj;
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
    result?: SafeRolloutSnapshotResult;
    error?: string;
  }): Promise<SafeRolloutSnapshotInterface> {
    if (result?.unknownVariations.length) {
      logger.error(new Error("More than 2 variations on a safe rollout"));
    }
    const strippedResult = omit(result, ["unknownVariations"]);
    const updates: Partial<SafeRolloutSnapshotInterface> = {
      queries,
      ...(runStarted && { runStarted }),
      error,
      ...strippedResult,
      status:
        status === "running"
          ? "running"
          : status === "failed"
            ? "error"
            : "success",
    };
    await this.context.models.safeRolloutSnapshots.updateById(
      this.model.id,
      updates,
    );
    return {
      ...this.model,
      ...updates,
    };
  }
}
