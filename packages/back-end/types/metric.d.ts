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
  users: number;
  average: number;
  stddev?: number;
  count?: number;
  percentiles: { p: number; v: number }[];
  dates: { d: Date; v: number }[];
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
  conversionWindowDays?: number;
  tags?: string[];
  dateCreated: Date;
  dateUpdated: Date;
  userIdType?: "anonymous" | "user" | "either";
  queries: Queries;
  runStarted: Date;
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
