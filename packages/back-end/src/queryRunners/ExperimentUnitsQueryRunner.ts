import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "../../types/experiment-snapshot";
import { MetricInterface } from "../../types/metric";
import { Queries, QueryPointer, QueryStatus } from "../../types/query";
import { SegmentInterface } from "../../types/segment";
import {
  findSnapshotById,
  updateSnapshot,
} from "../models/ExperimentSnapshotModel";
import { findSegmentById } from "../models/SegmentModel";
import { parseDimensionId } from "../services/experiments";
import {
  ExperimentUnitsQueryParams,
  SourceIntegrationInterface,
} from "../types/Integration";
import { QueryRunner } from "./QueryRunner";

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
  queryParentId: string;
};

export const startExperimentUnitQuery = async (
  params: ExperimentResultsQueryParams,
  integration: SourceIntegrationInterface,
  organization: string,
  startQuery: (
    name: string,
    query: string,
    // eslint-disable-next-line
    run: (query: string) => Promise<any[]>,
    // eslint-disable-next-line
    process: (rows: any[]) => any,
    useExisting?: boolean
  ) => Promise<QueryPointer>
): Promise<Queries> => {
  const snapshotSettings = params.snapshotSettings;
  const queryParentId = params.queryParentId;

  let segmentObj: SegmentInterface | null = null;
  if (snapshotSettings.segment) {
    segmentObj = await findSegmentById(snapshotSettings.segment, organization);
  }

  const dimensionObj = await parseDimensionId(
    snapshotSettings.dimensions[0]?.id,
    organization
  );

  // TODO pass forward table/schema/pre-fix from SourceIntegrationInterface
  const unitsTableName = `sample.${queryParentId}`;
  const queryParams: ExperimentUnitsQueryParams = {
    dimension: dimensionObj,
    segment: segmentObj,
    settings: snapshotSettings,
    unitsTableName: unitsTableName,
  };
  const query = await startQuery(
    queryParentId,
    integration.getExperimentUnitsQuery(queryParams),
    (query) => integration.runExperimentUnitsQuery(query),
    (rows) => rows
  );

  return [query];
};

export class ExperimentUnitsQueryRunner extends QueryRunner<
  ExperimentSnapshotInterface,
  ExperimentResultsQueryParams,
  SnapshotResult
> {
  private variationNames: string[] = [];
  private metricMap: Map<string, MetricInterface> = new Map();

  async startQueries(params: ExperimentResultsQueryParams): Promise<Queries> {
    this.metricMap = params.metricMap;
    this.variationNames = params.variationNames;

    return startExperimentUnitQuery(
      params,
      this.integration,
      this.model.organization,
      this.startQuery.bind(this)
    );
  }

  async runAnalysis(): Promise<SnapshotResult> {
    // TODO change result
    return { unknownVariations: [], multipleExposures: 0, analyses: [] };
  }
  async getLatestModel(): Promise<ExperimentSnapshotInterface> {
    const obj = await findSnapshotById(this.model.organization, this.model.id);
    if (!obj) throw new Error("Could not load snapshot model");
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
    runStarted?: Date | undefined;
    result?: SnapshotResult | undefined;
    error?: string | undefined;
  }): Promise<ExperimentSnapshotInterface> {
    const updates: Partial<ExperimentSnapshotInterface> = {
      queries,
      runStarted,
      error,
      ...result,
      status:
        status === "running"
          ? "running"
          : status === "failed"
          ? "error"
          : "success",
    };
    await updateSnapshot(this.model.organization, this.model.id, updates);
    return {
      ...this.model,
      ...updates,
    };
  }
}
