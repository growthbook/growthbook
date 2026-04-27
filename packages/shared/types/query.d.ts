import { z } from "zod";
import {
  queryPointerValidator,
  queryStatusValidator,
  sqlResultChunkValidator,
} from "shared/validators";
import type { PopulationDataInterface } from "shared/types/population-data";
import { QueryLanguage } from "./datasource";

export type SqlResultChunkInterface = z.infer<typeof sqlResultChunkValidator>;

export type QueryStatus = z.infer<typeof queryStatusValidator>;

export type QueryPointer = z.infer<typeof queryPointerValidator>;

export type Queries = QueryPointer[];

export type QueryStatistics = {
  executionDurationMs?: number;
  totalSlotMs?: number;
  rowsProcessed?: number;
  bytesProcessed?: number;
  bytesBilled?: number;
  rowsInserted?: number;
  warehouseCachedResult?: boolean;
  partitionsUsed?: boolean;
  physicalWrittenBytes?: number;
};

export type QueryType =
  | ""

  // ---
  // Metadata queries used to power various GrowthBook features
  // ---
  // Query that scans for past experiments for the purpose of importing existing experiments
  | "pastExperiment"
  // Query run to update pre-specified slices for experiment dimensions
  | "dimensionSlices"
  // Queries used by the power calculator
  | "populationMetric"
  | "populationMultiMetric"

  // ---
  // Experiment queries run for each experiment
  // ---

  // Standard experiment queries
  // Queries for legacy metrics in an experiment update
  | "experimentMetric"
  // Queries for fact metrics in an experiment update (may only actually have one metric)
  | "experimentMultiMetric"
  // Query run to update the experiment traffic data for the health tab
  | "experimentTraffic"

  // 2 additional queries associated with having pipeline mode "ephemeral" enabled
  | "experimentUnits"
  | "experimentDropUnitsTable"

  // Queries associated with an experiment update using incremental refresh
  | "experimentIncrementalRefreshCreateUnitsTable"
  | "experimentIncrementalRefreshDropUnitsTable"
  | "experimentIncrementalRefreshDropTempUnitsTable"
  | "experimentIncrementalRefreshUpdateUnitsTable"
  | "experimentIncrementalRefreshAlterUnitsTable"
  | "experimentIncrementalRefreshMaxTimestampUnitsTable"
  | "experimentIncrementalRefreshCreateMetricsSourceTable"
  | "experimentIncrementalRefreshInsertMetricsSourceData"
  | "experimentIncrementalRefreshMaxTimestampMetricsSource"
  | "experimentIncrementalRefreshDropMetricsCovariateTable"
  | "experimentIncrementalRefreshCreateMetricsCovariateTable"
  | "experimentIncrementalRefreshInsertMetricsCovariateData"
  | "experimentIncrementalRefreshStatistics"
  | "experimentIncrementalRefreshHealth"

  // ---
  // Standalone analysis queries
  // ---
  // Standalone metric analysis query on legacy of fact metric page
  | "metricAnalysis"
  // Query used by the product analytics tool
  | "productAnalyticsExploration"

  // ---
  // Non-persisted / utility queries (for cost attribution tracking)
  // ---
  // SQL explorer ad-hoc queries
  | "freeFormQuery"
  // Connection tests and validation queries
  | "testQuery"
  // Fact table column/SQL validation
  | "factTableValidation"
  // Pipeline write permission tests
  | "pipelineValidation"
  // User experiment exposures lookup
  | "userExposure"
  // Feature evaluation diagnostics
  | "featureEvalDiagnostics"

  // ---
  // Legacy, should be deprecated
  // ---
  | "experimentResults";

export type ExperimentQueryMetadata = {
  experimentProject?: string;
  experimentOwner?: string;
  experimentTags?: string[];
};

export type AdditionalQueryMetadata = ExperimentQueryMetadata;

export type QueryDocMetadata = {
  queryType?: QueryType;
};

export type QueryMetadata = AdditionalQueryMetadata &
  QueryDocMetadata & {
    userName?: string;
    userId?: string;
  };

export interface QueryInterface {
  id: string;
  displayTitle?: string;
  organization: string;
  datasource: string;
  language: QueryLanguage;
  query: string;
  status: QueryStatus;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  heartbeat: Date;
  // eslint-disable-next-line
  result?: Record<string, any>;
  queryType?: QueryType;
  // eslint-disable-next-line
  rawResult?: Record<string, any>[];
  error?: string;
  dependencies?: string[]; // must succeed before running query
  runAtEnd?: boolean; // only run when all other queries in model finish
  cachedQueryUsed?: string;
  statistics?: QueryStatistics;
  externalId?: string;
  hasChunkedResults?: boolean;
}
export type PopulationDataQuerySettings = Pick<
  PopulationDataInterface,
  "startDate" | "endDate" | "sourceId" | "sourceType" | "userIdType"
>;
