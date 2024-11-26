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
  | "experimentMultiMetric";

export interface QueryInterface {
  id: string;
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
  rawResult?: Record<string, number | string | boolean | object>[];
  error?: string;
  dependencies?: string[]; // must succeed before running query
  runAtEnd?: boolean; // only run when all other queries in model finish
  cachedQueryUsed?: string;
  statistics?: QueryStatistics;
  externalId?: string;
}
