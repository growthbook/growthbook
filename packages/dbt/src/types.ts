// Structural subset of dbt's manifest.json that the translator reads. Both the
// legacy YAML spec (measures + type_params.measure) and the v1.12 spec
// (metric_aggregation_params) land in this shape after `dbt parse`.
export interface DbtConfig {
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtEntity {
  name: string;
  type: string;
  expr?: string | null;
}
export interface DbtDimension {
  name: string;
  type: string;
  expr?: string | null;
}
export interface DbtAggParams {
  percentile?: number | null;
  use_discrete_percentile?: boolean | null;
}
export interface DbtMeasure {
  name: string;
  agg: string;
  expr?: string | null;
  label?: string | null;
  agg_params?: DbtAggParams | null;
  agg_time_dimension?: string | null;
  non_additive_dimension?: unknown;
}
export interface DbtSemanticModel {
  name: string;
  label?: string | null;
  description?: string | null;
  node_relation?: { relation_name?: string | null } | null;
  defaults?: { agg_time_dimension?: string | null } | null;
  primary_entity?: string | null;
  entities?: DbtEntity[] | null;
  dimensions?: DbtDimension[] | null;
  measures?: DbtMeasure[] | null;
  config?: DbtConfig | null;
  tags?: string[] | null;
}
export interface DbtFilter {
  where_filters?: { where_sql_template: string }[] | null;
}
export interface DbtInput {
  name: string;
  filter?: DbtFilter | null;
  alias?: string | null;
}
export interface DbtWindow {
  count: number;
  granularity: string;
}
export interface DbtMetricTypeParams {
  measure?: DbtInput | null;
  numerator?: DbtInput | null;
  denominator?: DbtInput | null;
  expr?: string | null;
  window?: DbtWindow | null;
  grain_to_date?: string | null;
  metrics?: DbtInput[] | null;
  conversion_type_params?: {
    base_measure?: DbtInput | null;
    base_metric?: DbtInput | null;
    conversion_measure?: DbtInput | null;
    conversion_metric?: DbtInput | null;
    entity: string;
    calculation?: string | null;
    window?: DbtWindow | null;
    constant_properties?: unknown[] | null;
  } | null;
  cumulative_type_params?: {
    window?: DbtWindow | null;
    grain_to_date?: string | null;
    metric?: DbtInput | null;
  } | null;
  metric_aggregation_params?: {
    semantic_model: string;
    agg: string;
    agg_params?: DbtAggParams | null;
    agg_time_dimension?: string | null;
    non_additive_dimension?: unknown;
  } | null;
}
export interface DbtMetric {
  name: string;
  label?: string | null;
  description?: string | null;
  type: string;
  type_params?: DbtMetricTypeParams | null;
  filter?: DbtFilter | null;
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtNode {
  name: string;
  resource_type: string;
  relation_name?: string | null;
  config?: DbtConfig | null;
  meta?: Record<string, unknown> | null;
  tags?: string[] | null;
}
export interface DbtManifest {
  nodes?: Record<string, DbtNode> | DbtNode[] | null;
  semantic_models?:
    | Record<string, DbtSemanticModel>
    | DbtSemanticModel[]
    | null;
  metrics?: Record<string, DbtMetric> | DbtMetric[] | null;
}

// Subset of the /bulk-import/facts payload this tool emits. The API validates
// the full shape; these types only keep the translator honest.
export type WindowUnit = "minutes" | "hours" | "days" | "weeks";
export type RowFilterOperator =
  | "sql_expr"
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "in"
  | "not_in"
  | "is_null"
  | "not_null"
  | "is_true"
  | "is_false";
export interface RowFilter {
  operator: RowFilterOperator;
  column?: string;
  values?: string[];
}
export interface ColumnRef {
  factTableId: string;
  column?: string;
  aggregation?: "max" | "count distinct";
  rowFilters?: RowFilter[];
}
export interface FunnelStep {
  name: string;
  factTableId: string;
  rowFilters: RowFilter[];
  optional: boolean;
  conversionWindow?: { unit: WindowUnit; value: number };
}
export interface FactTableColumn {
  column: string;
  datatype: "" | "number" | "string" | "boolean" | "date";
  isVirtual?: boolean;
  sql?: string;
}
export interface FactTableData {
  name: string;
  description?: string;
  tags?: string[];
  datasource: string;
  userIdTypes: string[];
  userIdColumns?: Record<string, string>;
  sql: string;
  timestampColumn: string;
  columns: FactTableColumn[];
  [key: string]: unknown;
}
export interface FactMetricData {
  name: string;
  description?: string;
  tags?: string[];
  metricType: string;
  numerator?: ColumnRef;
  denominator?: ColumnRef;
  windowSettings?:
    | { type: "lookback"; windowValue: number; windowUnit: WindowUnit }
    | { type: "none" };
  quantileSettings?: { type: "event"; quantile: number; ignoreZeros: boolean };
  funnelSettings?: { steps: FunnelStep[] };
  [key: string]: unknown;
}
export interface BulkImportPayload {
  defaultManagedBy: "dbt";
  factTables: { id: string; data: FactTableData }[];
  factMetrics: { id: string; data: FactMetricData }[];
}
export interface TranslateWarning {
  level: "skipped" | "note";
  resource: string;
  message: string;
}
export interface TranslateOptions {
  datasource: string;
  // dbt entity name -> GrowthBook identifier type. Unmapped entities keep their name.
  entities?: Record<string, string>;
  // Identifier types the Data Source defines. When given, entities that don't map to one are ignored.
  idTypes?: string[];
  // Name globs or `tag:<tag>` matched against metrics and semantic models.
  select?: string[];
  exclude?: string[];
}
export interface TranslateResult {
  payload: BulkImportPayload;
  warnings: TranslateWarning[];
}
