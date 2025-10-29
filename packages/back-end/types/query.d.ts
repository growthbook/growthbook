import { z } from "zod";
import {
  queryPointerValidator,
  queryStatusValidator,
} from "back-end/src/validators/queries";
import { QueryLanguage } from "./datasource";

export type QueryStatus = z.infer<typeof queryStatusValidator>;

export type QueryPointer = z.infer<typeof queryPointerValidator>;

export type Queries = QueryPointer[];

export type QueryStatistics = {
  executionDurationMs?: number;
  totalSlotMs?: number;
  rowsProcessed?: number;
  bytesProcessed?: number;
  bytesBilled?: number;
  warehouseCachedResult?: boolean;
  partitionsUsed?: boolean;
  physicalWrittenBytes?: number;
};

export type ExperimentQueryMetadata = {
  experimentProject?: string;
  experimentOwner?: string;
  experimentTags?: string[];
};

export type AdditionalQueryMetadata = ExperimentQueryMetadata;

export type QueryMetadata = AdditionalQueryMetadata & {
  userName?: string;
  userId?: string;
};

export type QueryType =
  | ""
  | "pastExperiment"
  | "metricAnalysis"
  | "experimentMetric"
  | "dimensionSlices"
  | "experimentUnits"
  | "experimentDropUnitsTable"
  | "experimentResults"
  | "experimentTraffic"
  | "experimentMultiMetric"
  | "populationMetric"
  | "populationMultiMetric"
  | "experimentIncrementalRefreshDropUnitsTable"
  | "experimentIncrementalRefreshDropTempUnitsTable"
  | "experimentIncrementalRefreshCreateUnitsTable"
  | "experimentIncrementalRefreshUpdateUnitsTable"
  | "experimentIncrementalRefreshAlterUnitsTable"
  | "experimentIncrementalRefreshMaxTimestampUnitsTable"
  | "experimentIncrementalRefreshMaxTimestampMetricsSource"
  | "experimentIncrementalRefreshStatistics"
  | "experimentIncrementalRefreshCreateMetricsSourceTable"
  | "experimentIncrementalRefreshInsertMetricsSourceData"
  | "experimentIncrementalRefreshCreateMetricsCovariateTable"
  | "experimentIncrementalRefreshInsertMetricsCovariateData"
  | "experimentIncrementalRefreshHealth";

export interface QueryInterface {
  id: string;
  // user facing title for use in modal
  title?: string;
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
}
