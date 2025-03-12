import { ExperimentMetricInterface } from "shared/experiments";
import { Queries, QueryStatus } from "back-end/types/query";
import {
  ExperimentReportInterface,
  ExperimentReportResults,
} from "back-end/types/report";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { getReportById, updateReport } from "back-end/src/models/ReportModel";
import { getSnapshotSettingsFromReportArgs } from "back-end/src/services/reports";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import {
  SafeRolloutSnapshotAnalysis,
  SafeRolloutSnapshotHealth,
  SafeRolloutSnapshotInterface,
} from "back-end/src/validators/safe-rollout";
import {
  ExperimentResultsQueryParams,
  startExperimentResultQueries,
} from "./ExperimentResultsQueryRunner";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type SnapshotResult = {
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
  SnapshotResult
> {
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  // TODO: Decide if we want more granular permissions here for safe rollouts
  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource
    );
  }

  async startQueries(params: SafeRolloutQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;

    const { snapshotSettings } = getSnapshotSettingsFromReportArgs(
      this.model.settings,
      params.metricMap
    );

    const experimentParams: ExperimentResultsQueryParams = {
      metricMap: params.metricMap,
      snapshotSettings,
      variationNames: this.model.variations.map((v) => v.name),
      queryParentId: this.model.id,
      factTableMap: params.factTableMap,
    };

    return startExperimentResultQueries(
      this.context,
      experimentParams,
      this.integration,
      this.startQuery.bind(this)
    );
  }
  async runAnalysis(queryMap: QueryMap): Promise<ExperimentReportResults> {
    if (this.model.type === "experiment") {
      const {
        snapshotSettings,
        analysisSettings,
      } = getSnapshotSettingsFromReportArgs(this.model.args, this.metricMap);

      // todo: bandits? (probably not needed)
      const { results } = await analyzeExperimentResults({
        variationNames: this.model.settings.variations.map((v) => v.name),
        queryData: queryMap,
        metricMap: this.metricMap,
        snapshotSettings,
        analysisSettings: [analysisSettings],
      });
      return results[0];
    }

    throw new Error("Unsupported report type");
  }
  async getLatestModel(): Promise<SafeRolloutSnapshotInterface> {
    const obj = await this.context.models.safeRolloutSnapshots.getById(
      this.model.id
    );
    if (!obj) throw new Error("Could not load snapshot model");
    return obj;
  }
  async updateModel({
    queries,
    runStarted,
    result,
    error,
  }: {
    status: QueryStatus;
    queries: Queries;
    runStarted?: Date | undefined;
    result?: ExperimentReportResults | undefined;
    error?: string | undefined;
  }): Promise<SafeRolloutSnapshotInterface> {
    const updates: Partial<SafeRolloutSnapshotInterface> = {
      queries,
      runStarted,
      error: error || "",
      results: result,
    };
    await this.context.models.safeRolloutSnapshots.updateById(
      this.model.id,
      updates
    );
    return {
      ...this.model,
      ...updates,
    };
  }
}
