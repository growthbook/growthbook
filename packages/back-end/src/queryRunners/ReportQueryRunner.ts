import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { MetricInterface } from "../../types/metric";
import { Queries, QueryStatus } from "../../types/query";
import { ExperimentReportResults, ReportInterface } from "../../types/report";
import { getReportById, updateReport } from "../models/ReportModel";
import { getSnapshotSettingsFromReportArgs } from "../services/reports";
import { analyzeExperimentResults } from "../services/stats";
import { startExperimentResultQueries } from "./ExperimentResultsQueryRunner";
import { QueryRunner, QueryMap } from "./QueryRunner";

export type SnapshotResult = {
  unknownVariations: string[];
  multipleExposures: number;
  analyses: ExperimentSnapshotAnalysis[];
};

export type ExperimentResultsQueryParams = {
  snapshotSettings: ExperimentSnapshotSettings;
  analysisSettings: ExperimentSnapshotAnalysisSettings;
  variationNames: string[];
  metricMap: Map<string, MetricInterface>;
};

export class ReportQueryRunner extends QueryRunner<
  ReportInterface,
  ExperimentResultsQueryParams,
  ExperimentReportResults
> {
  private metricMap: Map<string, MetricInterface> = new Map();

  async startQueries(params: ExperimentResultsQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;

    return startExperimentResultQueries(
      params,
      this.integration,
      this.model.organization,
      this.startQuery.bind(this)
    );
  }
  async runAnalysis(queryMap: QueryMap): Promise<ExperimentReportResults> {
    if (this.model.type === "experiment") {
      const {
        snapshotSettings,
        analysisSettings,
      } = getSnapshotSettingsFromReportArgs(this.model.args, this.metricMap);

      return await analyzeExperimentResults({
        variationNames: this.model.args.variations.map((v) => v.name),
        queryData: queryMap,
        metricMap: this.metricMap,
        snapshotSettings,
        analysisSettings,
      });
    }

    throw new Error("Unsupported report type");
  }
  async getLatestModel(): Promise<ReportInterface> {
    const obj = await getReportById(this.model.organization, this.model.id);
    if (!obj) throw new Error("Could not load report model");
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
  }): Promise<ReportInterface> {
    const updates: Partial<ReportInterface> = {
      queries,
      runStarted,
      error,
      results: result,
    };
    await updateReport(this.model.organization, this.model.id, updates);
    return {
      ...this.model,
      ...updates,
    };
  }
}
