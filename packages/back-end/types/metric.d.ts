import { Queries } from "./query";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=";
export type MetricType = "binomial" | "count" | "duration" | "revenue";

export interface MetricStats {
  count: number;
  stddev: number;
  mean: number;
}

export interface MetricAnalysis {
  createdAt: Date;
  segment?: string;
  users: number;
  average: number;
  stddev?: number;
  count?: number;
  percentiles: { p: number; v: number }[];
  dates: { d: Date; v: number; s?: number; u?: number }[];
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
  earlyStart: boolean;
  inverse: boolean;
  ignoreNulls: boolean;
  cap?: number;
  conversionWindowHours?: number;
  tags?: string[];
  winRisk?: number;
  loseRisk?: number;
  maxPercentChange?: number;
  minSampleSize?: number;
  segment?: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  userIdType?: "anonymous" | "user" | "either";
  queries: Queries;
  runStarted: Date | null;
  analysis?: MetricAnalysis;
  sql?: string;
  // Query Builder Props (alternative to sql)
  table?: string;
  column?: string;
  userIdColumn?: string;
  anonymousIdColumn?: string;
  timestampColumn?: string;
  conditions?: Condition[];
}
