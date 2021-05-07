import { Queries } from "./query";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=";
export type MetricType = "binomial" | "count" | "duration" | "revenue";

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
  table: string;
  column: string;
  earlyStart: boolean;
  inverse: boolean;
  ignoreNulls: boolean;
  cap?: number;
  dateCreated: Date;
  dateUpdated: Date;
  userIdColumn?: string;
  anonymousIdColumn?: string;
  userIdType?: "anonymous" | "user" | "either";
  timestampColumn?: string;
  conditions: Condition[];
  queries: Queries;
  runStarted: Date;
  analysis?: MetricAnalysis;
}
