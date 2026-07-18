import type { SqlLanguage } from "sql-formatter";
import type { DataType } from "./integrations";

export type StringMatchOperator =
  | "starts_with"
  | "ends_with"
  | "contains"
  | "not_contains";

export type StringMatchFn = (
  columnExpr: string,
  operator: StringMatchOperator,
  value: string,
) => string;

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

export type ApproxTopValuesParams = {
  /** One entry per string column: logical name + the value SQL expression (cast to string). */
  pairs: UnpivotLabeledPair[];
  /** CTE/table the aggregate scans (e.g. `__factTable`). */
  fromTable: string;
  /** Boolean predicate for the WHERE clause, without the `WHERE` keyword (e.g. `timestamp >= '...'`). */
  whereClause: string;
  /** Number of top values to return per column (k). */
  limit: number;
  /** Drop values longer than this many characters before counting. */
  maxValueLength?: number;
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
  stringMatch: StringMatchFn;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  dateTrunc: (
    column: string,
    granularity: "hour" | "day" | "week" | "month" | "year",
  ) => string;
  dateDiff: (startCol: string, endCol: string) => string;
  /**
   * Millisecond difference `endCol - startCol`. Used by funnel SQL for
   * per-step time-from-previous stats. Default implementation works in
   * Postgres-flavored dialects; ClickHouse and friends override it.
   */
  dateDiffMs: (startCol: string, endCol: string) => string;
  /**
   * Shift a timestamp expression by `amount` seconds. `sign` is "+" or "-".
   * Used by funnel SQL to apply concurrency tolerance / conversion-window
   * bounds. Default implementation uses ANSI `INTERVAL '<n> seconds'`
   * arithmetic; dialects without that syntax should override.
   */
  addIntervalSeconds: (col: string, sign: "+" | "-", amount: number) => string;
  percentileApprox: (column: string, percentile: number | string) => string;
  toTimestamp: (date: Date) => string;
  castToFloat: (column: string) => string;
  castToString: (column: string) => string;
  castToDate: (column: string) => string;
  /**
   * Cast `column` to the dialect's TIMESTAMP type. Used by funnel SQL when
   * UNION-ing per-fact-table events: a fact table that doesn't source a
   * given step emits `NULL` for that step's timestamp column, and Postgres
   * (along with some other engines) infers untyped `NULL` as `text` —
   * which then mismatches the actual timestamp values from the other side
   * of the UNION. Wrapping the NULL with this gives it a concrete type.
   * Dialects whose nullable type system requires a different form (e.g.
   * ClickHouse's `Nullable(DateTime)`) should override.
   */
  castToTimestamp: (column: string) => string;
  castUserDateCol: (column: string) => string;
  /**
   * Aggregate `col` across the group into an array sorted ascending, with
   * NULL values filtered out. Used by funnel SQL to materialize one
   * sorted timestamp array per user per step in a single GROUP BY pass —
   * the chained step-resolution CTEs then look up matching timestamps via
   * `arrayMinInRange` instead of self-joining the full event log.
   */
  arrayAggSorted: (col: string) => string;
  /**
   * Aggregate value: returns `valueCol` from the row where `tsCol` is the
   * minimum non-null timestamp in the group. Used by funnel SQL to capture
   * the first-touch dimension alongside step 1's resolved timestamp without
   * a separate ROW_NUMBER pass over the events.
   */
  argMinByTimestamp: (valueCol: string, tsCol: string) => string;
  /**
   * Scalar expression: returns the smallest element of `arrayExpr` that
   * lies in `[lowerBound, upperBound]`, or NULL if no element matches.
   * Either bound may be `null` for "no constraint on that side". Used by
   * funnel SQL to resolve follow-on steps within the conversion window
   * after the prior step's resolved timestamp. NULL-typed bounds
   * (e.g. when the previous step wasn't resolved for this user) must
   * propagate through to a NULL result — `t >= NULL` is NULL/FALSE for
   * every `t`, so the natural filter semantics short-circuit correctly.
   */
  arrayMinInRange: (
    arrayExpr: string,
    lowerBound: string | null,
    upperBound: string | null,
  ) => string;
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
  /**
   * Positional access into an array column, returning a numeric expression.
   * `index` is 0-based logical; each dialect translates to its own array
   * semantics (1-based vs 0-based, native array vs JSON).
   */
  arrayElement: (arrayCol: string, index: number) => string;
  approxTopValuesCTEBody?: (params: ApproxTopValuesParams) => string;
}
