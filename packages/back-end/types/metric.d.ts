import { Queries } from "./query";
import { TemplateVariables } from "./sql";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=" | "=>";
export type MetricType = "binomial" | "count" | "duration" | "revenue";
export type MetricStatus = "active" | "archived";
export type MetricCappingType = null | "absolute" | "percentile";

// Keep MetricStats in sync with gbstats
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
  histogram?: { b: string; c: number }[];
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
  owner: string;
  datasource: string;
  name: string;
  description: string;
  type: MetricType;
  earlyStart?: boolean;
  inverse: boolean;
  ignoreNulls: boolean;
  capping?: MetricCappingType;
  capValue?: number;
  denominator?: string;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  tags?: string[];
  projects?: string[];
  winRisk?: number;
  loseRisk?: number;
  maxPercentChange?: number;
  minPercentChange?: number;
  minSampleSize?: number;
  regressionAdjustmentOverride?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentDays?: number;
  segment?: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  userIdTypes?: string[];
  userIdColumns?: Record<string, string>;
  queries: Queries;
  runStarted: Date | null;
  analysis?: MetricAnalysis;
  analysisError?: string;
  status?: MetricStatus;
  sql?: string;
  aggregation?: string;
  templateVariables?: TemplateVariables;
  // Query Builder Props (alternative to sql)
  table?: string;
  column?: string;
  timestampColumn?: string;
  conditions?: Condition[];
  queryFormat?: "sql" | "builder";
}

export type LegacyMetricInterface = MetricInterface & {
  cap?: number;
  userIdType?: "anonymous" | "user" | "either";
  userIdColumn?: string;
  anonymousIdColumn?: string;
};
