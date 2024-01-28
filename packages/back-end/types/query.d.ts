import { QueryLanguage } from "./datasource";

export type QueryStatus =
  | "queued"
  | "running"
  | "failed"
  | "partially-succeeded"
  | "succeeded";

export type QueryStatistics = {
  executionDurationMs?: number;
  totalSlotMs?: number;
  bytesProcessed?: number;
  bytesBilled?: number;
  warehouseCachedResult?: boolean;
  partitionsUsed?: boolean;
};

export type QueryPointer = {
  query: string;
  status: QueryStatus;
  name: string;
};
export type Queries = QueryPointer[];

export type QueryType =
  | ""
  | "pastExperiment"
  | "metricAnalysis"
  | "experimentMetric"
  | "dimensionSlices"
  | "experimentUnits"
  | "experimentResults"
  | "experimentTraffic"
  | "experimentMultiMetric";

export interface QueryInterface {
  id: string;
  organization: string;
  datasource: string;
  language: QueryLanguage;
  query: string;
  labels: Record<string, string>;
  status: QueryStatus;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  heartbeat: Date;
  // eslint-disable-next-line
  result?: Record<string, any>;
  queryType?: QueryType;
  rawResult?: Record<string, number | string | boolean | object>[];
  error?: string;
  dependencies?: string[];
  cachedQueryUsed?: string;
  statistics?: QueryStatistics;
  externalId?: string;
}
