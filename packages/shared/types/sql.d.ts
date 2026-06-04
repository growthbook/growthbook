import type { SqlLanguage } from "sql-formatter";
import { DataType } from "./integrations";

/** One labeled column expanded per base row by {@link SqlDialect.unpivotLabeledPairs}. */
export type UnpivotLabeledPair = {
  /** Logical name (unescaped); dialect may quote as a SQL string literal. */
  keyLiteral: string;
  /** SQL expression evaluated per base row (e.g. cast of a column). */
  valueSql: string;
};

/** Join SQL and output expressions for static labeled-pair unpivot (engine-specific syntax). */
export type UnpivotLabeledPairsResult = {
  /** Placed after `FROM __factTable` (includes leading newline/CROSS JOIN/comma as needed). */
  fromContinuation: string;
  keyExpr: string;
  valueExpr: string;
};

export type TemplateVariables = {
  eventName?: string;
  valueColumn?: string;
};

export type PhaseSQLVar = {
  index?: string;
};

export type SQLVars = {
  startDate: Date;
  endDate?: Date;
  experimentId?: string;
  phase?: PhaseSQLVar;
  customFields?: Record<string, unknown>;
  templateVariables?: TemplateVariables;
};

// SQL formatter dialect type - uses sql-formatter's SqlLanguage, plus "" for no formatting
export type FormatDialect = SqlLanguage | "";

export type DateTruncGranularity = "hour" | "day" | "week" | "month" | "year";

export interface SqlDialect {
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (
    column: string,
    granularity: "hour" | "day" | "week" | "month" | "year",
  ) => string;
  dateDiff: (startCol: string, endCol: string) => string;
  percentileApprox: (column: string, percentile: number | string) => string;
  toTimestamp: (date: Date) => string;
  castToFloat: (column: string) => string;
  castToString: (column: string) => string;
  castToDate: (column: string) => string;
  castUserDateCol: (column: string) => string;
  getCurrentTimestamp: () => string;
  ifElse: (condition: string, ifTrue: string, ifFalse: string) => string;
  getDataType: (dataType: DataType) => string;
  addTime: (
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ) => string;
  formatDate: (column: string) => string;
  formatDateTimeString: (column: string) => string;
  selectStarLimit: (
    from: string,
    limit: number,
    additionalClauses?: string,
  ) => string;
  defaultSchema: string;
  formatDialect: FormatDialect;
  percentileCapSelectClause: (
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number;
      ignoreZeros: boolean;
      sourceIndex: number;
    }[],
    metricTable: string,
    where?: string,
  ) => string;
  hasCountDistinctHLL: () => boolean;
  hllAggregate: (column: string) => string;
  hllReaggregate: (column: string) => string;
  hllCardinality: (column: string) => string;
  quantileSketchInit: (column: string) => string;
  quantileSketchMergePartial: (column: string) => string;
  quantileSketchExtractPoint: (column: string, quantile: number) => string;
  quantileSketchExtractQuantiles: (
    column: string,
    numQuantiles: number,
  ) => string;
  quantileSketchRankApprox: (
    sketchCol: string,
    thresholdCol: string,
    nEventsCol: string,
    numQuantiles: number,
  ) => string;
  hasArrayQuantileGrid: () => boolean;
  quantileGridArrayLiteral: (elements: string[]) => string;
  unpivotLabeledPairs: (
    pairs: UnpivotLabeledPair[],
  ) => UnpivotLabeledPairsResult;
  stringLength: (column: string) => string;
}
