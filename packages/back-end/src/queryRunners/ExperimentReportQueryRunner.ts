import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotAnalysis } from "back-end/types/experiment-snapshot";
import {
  ExperimentQueryMetadata,
  Queries,
  QueryStatus,
} from "back-end/types/query";
import {
  ExperimentReportInterface,
  ExperimentReportResults,
} from "back-end/types/report";
import { FactTableMap } from "back-end/src/models/FactTableModel";
import { MetricGroupInterface } from "back-end/types/metric-groups";
import { getReportById, updateReport } from "back-end/src/models/ReportModel";
import { getSnapshotSettingsFromReportArgs } from "back-end/src/services/reports";
import { analyzeExperimentResults } from "back-end/src/services/stats";
import {
  ExperimentResultsQueryParams,
  startExperimentResultQueries,
} from "./ExperimentResultsQueryRunner";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type SnapshotResult = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
};

export type ReportQueryParams = {
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  metricGroups: MetricGroupInterface[];
  experimentQueryMetadata: ExperimentQueryMetadata | null;
};

export class ExperimentReportQueryRunner extends QueryRunner<
  ExperimentReportInterface,
  ReportQueryParams,
  ExperimentReportResults
> {
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();
  private factTableMap: FactTableMap = new Map();
  private metricGroups: MetricGroupInterface[] = [];

  checkPermissions(): boolean {
    return this.context.permissions.canRunExperimentQueries(
      this.integration.datasource,
    );
  }

  async startQueries(params: ReportQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.factTableMap = params.factTableMap;
    this.metricGroups = params.metricGroups;

    const { snapshotSettings } = getSnapshotSettingsFromReportArgs(
      this.model.args,
      params.metricMap,
      params.factTableMap,
      undefined,
      params.metricGroups,
    );

    const experimentParams: ExperimentResultsQueryParams = {
      snapshotType: "report",
      metricMap: params.metricMap,
      snapshotSettings,
      variationNames: this.model.args.variations.map((v) => v.name),
      queryParentId: this.model.id,
      factTableMap: params.factTableMap,
      experimentQueryMetadata: params.experimentQueryMetadata,
    };

    return startExperimentResultQueries(
      this.context,
      experimentParams,
      this.integration,
      this.startQuery.bind(this),
    );
  }
  async runAnalysis(queryMap: QueryMap): Promise<ExperimentReportResults> {
    if (this.model.type === "experiment") {
      const { snapshotSettings, analysisSettings } =
        getSnapshotSettingsFromReportArgs(
          this.model.args,
          this.metricMap,
          this.factTableMap,
          undefined,
          this.metricGroups,
        );

      // todo: bandits? (probably not needed)
      const { results } = await analyzeExperimentResults({
        variationNames: this.model.args.variations.map((v) => v.name),
        queryData: queryMap,
        metricMap: this.metricMap,
        snapshotSettings,
        analysisSettings: [analysisSettings],
      });
      return results[0];
    }

    throw new Error("Unsupported report type");
  }
  async getLatestModel(): Promise<ExperimentReportInterface> {
    const obj = await getReportById(this.model.organization, this.model.id);
    if (!obj) throw new Error("Could not load report model");
    return obj as ExperimentReportInterface;
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
  }): Promise<ExperimentReportInterface> {
    const updates: Partial<ExperimentReportInterface> = {
      queries,
      runStarted,
      error: error || "",
      results: result,
    };
    await updateReport(this.model.organization, this.model.id, updates);
    return {
      ...this.model,
      ...updates,
    };
  }
}
