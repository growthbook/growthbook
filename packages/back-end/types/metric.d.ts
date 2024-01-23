import { Queries } from "./query";
import { TemplateVariables } from "./sql";

export type Operator = "=" | "!=" | "~" | "!~" | ">" | "<" | "<=" | ">=" | "=>";
export type MetricType = "binomial" | "count" | "duration" | "revenue";
export type MetricStatus = "active" | "archived";

type MetricWindowSettings = {
  window: "conversion" | "lookback" | "";
  delayHours: number;
  windowValue: number;
  windowUnit: "weeks" | "days" | "hours";
};
type CappingType = "absolute" | "percentile" | "";
type MetricCappingSettings = {
  capping: CappingType;
  value: number;
  ignoreZeros?: boolean;
};

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
  dateCreated: Date | null;
  dateUpdated: Date | null;
  name: string;
  description: string;
  tags?: string[];
  projects?: string[];
  status?: MetricStatus;

  userIdTypes?: string[];
  userIdColumns?: Record<string, string>;
  sql?: string;
  templateVariables?: TemplateVariables;
  segment?: string;
  type: MetricType;
  denominator?: string;
  inverse: boolean;
  aggregation?: string;

  ignoreNulls: boolean;
  earlyStart?: boolean;

  cappingSettings: MetricCappingSettings;
  windowSettings: MetricWindowSettings;

  winRisk?: number;
  loseRisk?: number;
  maxPercentChange?: number;
  minPercentChange?: number;
  minSampleSize?: number;

  regressionAdjustmentOverride?: boolean;
  regressionAdjustmentEnabled?: boolean;
  regressionAdjustmentDays?: number;

  // metric analysis fields
  queries: Queries;
  runStarted: Date | null;
  analysis?: MetricAnalysis;
  analysisError?: string;

  // Query Builder Props (alternative to sql)
  table?: string;
  column?: string;
  timestampColumn?: string;
  conditions?: Condition[];
  queryFormat?: "sql" | "builder";
}

export type LegacyMetricInterface = MetricInterface & {
  cap?: number;
  capping?: CappingType;
  capValue?: number;
  conversionWindowHours?: number;
  conversionDelayHours?: number;
  userIdType?: "anonymous" | "user" | "either";
  userIdColumn?: string;
  anonymousIdColumn?: string;
};
