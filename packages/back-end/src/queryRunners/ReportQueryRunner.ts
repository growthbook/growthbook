import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotAnalysis } from "../../types/experiment-snapshot";
import { Queries, QueryStatus } from "../../types/query";
import { ExperimentReportResults, ReportInterface } from "../../types/report";
import { FactTableMap } from "../models/FactTableModel";
import { getReportById, updateReport } from "../models/ReportModel";
import { getSnapshotSettingsFromReportArgs } from "../services/reports";
import { analyzeExperimentResults } from "../services/stats";
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
};

export class ReportQueryRunner extends QueryRunner<
  ReportInterface,
  ReportQueryParams,
  ExperimentReportResults
> {
  private metricMap: Map<string, ExperimentMetricInterface> = new Map();

  async startQueries(params: ReportQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;

    const { snapshotSettings } = getSnapshotSettingsFromReportArgs(
      this.model.args,
      params.metricMap
    );

    const experimentParams: ExperimentResultsQueryParams = {
      metricMap: params.metricMap,
      snapshotSettings,
      variationNames: this.model.args.variations.map((v) => v.name),
      queryParentId: this.model.id,
      factTableMap: params.factTableMap,
    };

    return startExperimentResultQueries(
      experimentParams,
      this.integration,
      this.organization,
      this.startQuery.bind(this)
    );
  }
  async runAnalysis(queryMap: QueryMap): Promise<ExperimentReportResults> {
    if (this.model.type === "experiment") {
      const {
        snapshotSettings,
        analysisSettings,
      } = getSnapshotSettingsFromReportArgs(this.model.args, this.metricMap);

      const res = await analyzeExperimentResults({
        variationNames: this.model.args.variations.map((v) => v.name),
        queryData: queryMap,
        metricMap: this.metricMap,
        snapshotSettings,
        analysisSettings: [analysisSettings],
      });
      return res[0];
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
