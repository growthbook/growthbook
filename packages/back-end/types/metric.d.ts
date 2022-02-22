import { Queries } from "./query";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=";
export type MetricType = "binomial" | "count" | "duration" | "revenue";
export type MetricStatus = "active" | "archived";

export interface MetricStats {
  users: number;
  count: number;
  stddev: number;
  mean: number;
}

export interface MetricAnalysis {
  createdAt: Date;
  segment?: string;
  average: number;
  stddev?: number;
  count?: number;
  percentiles: { p: number; v: number }[];
  dates: { d: Date; v: number; s?: number; c?: number }[];
}

export interface Condition {
  column: string;
  operator: Operator;
  value: string;
}
export interface MetricInterface {
  id: string;
  organization: string;
  datasource: string;
  name: string;
  description: string;
  type: MetricType;
  earlyStart?: boolean;
  inverse: boolean;
  ignoreNulls: boolean;
  cap?: number;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  tags?: string[];
  winRisk?: number;
  loseRisk?: number;
  maxPercentChange?: number;
  minPercentChange?: number;
  minSampleSize?: number;
  segment?: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  userIdType?: "anonymous" | "user" | "either";
  queries: Queries;
  runStarted: Date | null;
  analysis?: MetricAnalysis;
  analysisError?: string;
  status?: MetricStatus;
  sql?: string;
  aggregation?: string;
  // Query Builder Props (alternative to sql)
  table?: string;
  column?: string;
  userIdColumn?: string;
  anonymousIdColumn?: string;
  timestampColumn?: string;
  conditions?: Condition[];
}
