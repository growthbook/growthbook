import normal from "@stdlib/stats/base/dists/normal";
import cloneDeep from "lodash/cloneDeep";
import uniqid from "uniqid";
import {
  DEFAULT_GUARDRAIL_ALPHA,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  PRECOMPUTED_DIMENSION_PREFIX,
  NULL_DIMENSION_VALUE,
  NULL_DIMENSION_DISPLAY,
} from "shared/constants";
import { Variation } from "shared/validators";
import { MetricInterface } from "shared/types/metric";
import {
  ColumnRef,
  FactMetricInterface,
  FactTableColumnType,
  FactTableInterface,
  FactTableMap,
  MetricQuantileSettings,
  MetricWindowSettings,
  RowFilter,
} from "shared/types/fact-table";
import {
  MetricDefaults,
  OrganizationSettings,
} from "shared/types/organization";
import {
  AttributionModel,
  ExperimentInterface,
  ExperimentInterfaceStringDates,
  LookbackOverride,
  MetricOverride,
} from "shared/types/experiment";
import {
  ExperimentReportResultDimension,
  MetricSnapshotSettings,
} from "shared/types/report";
import {
  DataSourceInterfaceWithParams,
  DataSourceSettings,
} from "shared/types/datasource";
import { SnapshotMetric } from "shared/types/experiment-snapshot";
import {
  DifferenceType,
  IndexedPValue,
  PValueCorrection,
  StatsEngine,
} from "shared/types/stats";
import { MetricGroupInterface } from "shared/types/metric-groups";
import { TemplateVariables } from "../types/sql";
import { stringToBoolean } from "./util";

export type ExperimentMetricInterface = MetricInterface | FactMetricInterface;

export type ExperimentSortBy =
  | "significance"
  | "change"
  | "metrics"
  | "metricTags"
  | null;
export type SetExperimentSortBy = (value: ExperimentSortBy) => void;

export function formatDimensionValueForDisplay(
  value: string | undefined,
): string {
  if (!value) return "";
  if (value === NULL_DIMENSION_VALUE) {
    return NULL_DIMENSION_DISPLAY;
  }

  return value;
}

export function isFactMetricId(id: string): boolean {
  return !!id.match(/^fact__/);
}

export function isMetricGroupId(id: string): boolean {
  return !!id.match(/^mg_/);
}

export function isFactMetric(
  m: ExperimentMetricInterface,
): m is FactMetricInterface {
  if (!m || typeof m !== "object") return false;
  return "metricType" in m;
}

export function isLegacyMetric(
  m: ExperimentMetricInterface,
): m is MetricInterface {
  return !isFactMetric(m);
}

export function canInlineFilterColumn(
  factTable: Pick<FactTableInterface, "userIdTypes" | "columns">,
  column: string,
): boolean {
  // If the column is one of the identifier columns, it is not eligible for prompting
  if (factTable.userIdTypes.includes(column)) return false;

  const dataType = getSelectedColumnDatatype({
    factTable,
    column,
    excludeDeleted: true,
  });

  if (dataType !== "string" && dataType !== "boolean") {
    return false;
  }

  return true;
}

export function getColumnExpression(
  column: string,
  factTable: Pick<FactTableInterface, "columns">,
  // todo: add stringification for dimension cols that may not be string type
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string,
  alias: string = "",
): string {
  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json") {
      const path = parts.slice(1).join(".");

      const field = col.jsonFields?.[path];
      const isNumeric = field?.datatype === "number";

      return jsonExtract(
        alias ? `${alias}.${parts[0]}` : parts[0],
        path,
        isNumeric,
      );
    }
  }

  return alias ? `${alias}.${column}` : column;
}

export function getColumnRefWhereClause({
  factTable,
  columnRef,
  escapeStringLiteral,
  jsonExtract,
  evalBoolean,
  showSourceComment = false,
  sliceInfo,
}: {
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  columnRef: ColumnRef;
  escapeStringLiteral: (s: string) => string;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  evalBoolean: (col: string, value: boolean) => string;
  showSourceComment?: boolean;
  sliceInfo?: SliceMetricInfo;
}): string[] {
  const where = new Set<string>();

  // First add slice filters if this is a slice metric
  if (sliceInfo?.isSliceMetric) {
    // Apply filters for each slice level
    sliceInfo.sliceLevels.forEach((sliceLevel) => {
      const sliceColumn = factTable.columns.find(
        (col) => col.column === sliceLevel.column,
      );

      if (sliceColumn && !sliceColumn.deleted) {
        const columnExpr = getColumnExpression(
          sliceLevel.column,
          factTable,
          jsonExtract,
        );

        if (
          sliceLevel.levels.length === 0 ||
          (sliceColumn.datatype === "boolean" &&
            sliceLevel.levels[0] === "null")
        ) {
          // For "other" or "null", exclude all auto slice values
          if (sliceColumn.datatype === "boolean") {
            // For boolean "other"/"null", check for NULL values
            where.add(`(${columnExpr} IS NULL)`);
          } else if (
            sliceColumn.autoSlices &&
            sliceColumn.autoSlices.length > 0
          ) {
            const escapedValues = sliceColumn.autoSlices.map(
              (v: string) => "'" + escapeStringLiteral(v) + "'",
            );
            where.add(
              `(${columnExpr} NOT IN (\n  ${escapedValues.join(",\n  ")}\n))`,
            );
          }
        } else {
          // For specific auto slice values, filter to that value
          if (sliceColumn.datatype === "boolean") {
            const boolValue = stringToBoolean(sliceLevel.levels[0]);
            where.add(`(${evalBoolean(columnExpr, boolValue)})`);
            return;
          }

          where.add(
            `(${columnExpr} = '${escapeStringLiteral(sliceLevel.levels[0])}')`,
          );
        }
      }
    });
  }

  columnRef.rowFilters?.forEach((filter) => {
    const filterSQL = getRowFilterSQL({
      rowFilter: filter,
      factTable,
      jsonExtract,
      escapeStringLiteral,
      evalBoolean,
      showSourceComment,
    });
    if (filterSQL) {
      where.add(filterSQL);
    }
  });

  return [...where];
}

export function getRowFilterSQL({
  rowFilter,
  factTable,
  jsonExtract,
  escapeStringLiteral,
  evalBoolean,
  showSourceComment = false,
}: {
  rowFilter: RowFilter;
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  jsonExtract: (jsonCol: string, path: string, isNumeric: boolean) => string;
  escapeStringLiteral: (s: string) => string;
  evalBoolean: (col: string, value: boolean) => string;
  showSourceComment?: boolean;
}): string | null {
  // Some operators do not require a column
  if (rowFilter.operator === "saved_filter") {
    const filter = factTable.filters.find(
      (f) => f.id === rowFilter.values?.[0],
    );
    if (filter) {
      const comment = showSourceComment ? `-- Filter: ${filter.name}\n` : "";
      return comment + `(${filter.value})`;
    }
    return null;
  }
  if (rowFilter.operator === "sql_expr") {
    if (!rowFilter.values?.[0]) {
      return null;
    }
    return `(${rowFilter.values?.[0] || ""})`;
  }

  if (!rowFilter.column) {
    return null;
  }
  const columnExpr = getColumnExpression(
    rowFilter.column,
    factTable,
    jsonExtract,
  );
  const columnType = getSelectedColumnDatatype({
    factTable,
    column: rowFilter.column,
  });

  // If a boolean column is using equals operator, convert to is_true/is_false
  let operator = rowFilter.operator;
  if (
    operator === "=" &&
    rowFilter.values?.[0] === "true" &&
    columnType === "boolean"
  ) {
    operator = "is_true";
  }
  if (
    operator === "=" &&
    rowFilter.values?.[0] === "false" &&
    columnType === "boolean"
  ) {
    operator = "is_false";
  }

  // Some operators do not require values
  if (operator === "is_null") {
    return `(${columnExpr} IS NULL)`;
  }
  if (operator === "not_null") {
    return `(${columnExpr} IS NOT NULL)`;
  }
  if (operator === "is_true") {
    return `(${evalBoolean(columnExpr, true)})`;
  }
  if (operator === "is_false") {
    return `(${evalBoolean(columnExpr, false)})`;
  }

  if (!rowFilter.values?.length) {
    return null;
  }
  const escapedValues = [
    ...new Set(
      rowFilter.values.map((v) => {
        // Number, don't wrap in quotes
        if (columnType === "number" && v.match(/^-?(\d+|\d*\.\d+)$/)) {
          return v;
        }

        return "'" + escapeStringLiteral(v) + "'";
      }),
    ),
  ];

  const firstEscapedValue = escapedValues[0];

  // Convert single-value in/not_in to =/!=
  if (escapedValues.length === 1) {
    if (operator === "in") {
      operator = "=";
    } else if (operator === "not_in") {
      operator = "!=";
    }
  }

  const likeEscapedValue = escapeStringLiteral(rowFilter.values[0]).replace(
    /([%_])/g,
    "\\$1",
  );

  // Handle remaining operators
  switch (operator) {
    case "=":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return `(${columnExpr} ${operator} ${firstEscapedValue})`;
    case "in":
      return `(${columnExpr} IN (\n  ${escapedValues.join(",\n  ")}\n))`;
    case "not_in":
      return `(${columnExpr} NOT IN (\n  ${escapedValues.join(",\n  ")}\n))`;
    case "starts_with":
      return `(${columnExpr} LIKE '${likeEscapedValue}%')`;
    case "ends_with":
      return `(${columnExpr} LIKE '%${likeEscapedValue}')`;
    case "contains":
      return `(${columnExpr} LIKE '%${likeEscapedValue}%')`;
    case "not_contains":
      return `(${columnExpr} NOT LIKE '%${likeEscapedValue}%')`;

    // IMPORTANT: no default to ensure missing cases are caught by the compiler
  }
}

export function getAggregateFilters({
  columnRef,
  column,
  ignoreInvalid = false,
}: {
  columnRef: Pick<
    ColumnRef,
    "aggregateFilter" | "aggregateFilterColumn" | "column"
  > | null;
  column: string;
  ignoreInvalid?: boolean;
}) {
  if (!columnRef?.aggregateFilter) return [];
  if (!columnRef.aggregateFilterColumn) return [];

  // Only support distinctUsers for now
  if (columnRef.column !== "$$distinctUsers") return [];

  const parts = columnRef.aggregateFilter.replace(/\s*/g, "").split(",");

  const filters: string[] = [];
  parts.forEach((part) => {
    if (!part) return;

    // i.e. ">10" or "!=5.1"
    const match = part.match(/^(=|!=|<>|<|<=|>|>=)(\d+(\.\d+)?)$/);
    if (match) {
      const [, operator, value] = match;
      filters.push(`${column} ${operator} ${value}`);
    } else if (!ignoreInvalid) {
      throw new Error(`Invalid user filter: ${part}`);
    }
  });

  return filters;
}

export function getFactTableTemplateVariables(
  factTable: FactTableInterface,
): TemplateVariables {
  return {
    eventName: factTable.eventName,
  };
}

// TODO(sql): refactor to remove factTableMap
export function getMetricTemplateVariables(
  m: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean,
): TemplateVariables {
  if (isFactMetric(m)) {
    const columnRef = useDenominator ? m.denominator : m.numerator;
    if (!columnRef) return {};

    const factTable = factTableMap.get(columnRef.factTableId);
    if (!factTable) return {};

    return {
      eventName: factTable.eventName,
    };
  }

  return m.templateVariables || {};
}

export function isCappableMetricType(m: ExperimentMetricInterface) {
  return !quantileMetricType(m) && !isBinomialMetric(m);
}

export function isBinomialMetric(m: ExperimentMetricInterface) {
  if (isFactMetric(m))
    return ["proportion", "retention"].includes(m.metricType);
  return m.type === "binomial";
}

export function isRetentionMetric(m: ExperimentMetricInterface) {
  return isFactMetric(m) && m.metricType === "retention";
}

export function isRatioMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface,
): boolean {
  if (isFactMetric(m)) return m.metricType === "ratio";
  return !!denominatorMetric && !isBinomialMetric(denominatorMetric);
}

export function quantileMetricType(
  m: ExperimentMetricInterface,
): "" | MetricQuantileSettings["type"] {
  if (isFactMetric(m) && m.metricType === "quantile") {
    return m.quantileSettings?.type || "";
  }
  return "";
}

export function isFunnelMetric(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface,
): boolean {
  if (isFactMetric(m)) return false;
  return !!denominatorMetric && isBinomialMetric(denominatorMetric);
}

export function isRegressionAdjusted(
  m: ExperimentMetricInterface,
  denominatorMetric?: ExperimentMetricInterface,
) {
  const isLegacyRatioMetric: boolean =
    isRatioMetric(m, denominatorMetric) && !isFactMetric(m);
  return (
    (m.regressionAdjustmentDays ?? 0) > 0 &&
    !!m.regressionAdjustmentEnabled &&
    !isLegacyRatioMetric &&
    !quantileMetricType(m)
  );
}

export function isPercentileCappedMetric(metric: ExperimentMetricInterface) {
  return (
    metric.cappingSettings.type === "percentile" &&
    !!metric.cappingSettings.value &&
    metric.cappingSettings.value < 1 &&
    isCappableMetricType(metric)
  );
}

function isAbsoluteCappedMetric(metric: ExperimentMetricInterface) {
  return (
    metric.cappingSettings.type === "absolute" &&
    !!metric.cappingSettings.value &&
    isCappableMetricType(metric)
  );
}

export function isSliceMetric(metric: ExperimentMetricInterface) {
  return parseSliceMetricId(metric.id).isSliceMetric;
}

export function eligibleForUncappedMetric(metric: ExperimentMetricInterface) {
  return (
    (isPercentileCappedMetric(metric) || isAbsoluteCappedMetric(metric)) &&
    !isSliceMetric(metric)
  );
}

export function getMetricWindowHours(
  windowSettings: MetricWindowSettings,
): number {
  const value = windowSettings.windowValue;
  if (windowSettings.windowUnit === "minutes") return value / 60;
  if (windowSettings.windowUnit === "hours") return value;
  if (windowSettings.windowUnit === "days") return value * 24;
  if (windowSettings.windowUnit === "weeks") return value * 24 * 7;

  return 72;
}

export function getDelayWindowHours(
  windowSettings: MetricWindowSettings,
): number {
  const value = windowSettings.delayValue;
  if (windowSettings.delayUnit === "minutes") return value / 60;
  if (windowSettings.delayUnit === "hours") return value;
  if (windowSettings.delayUnit === "days") return value * 24;
  if (windowSettings.delayUnit === "weeks") return value * 24 * 7;

  return 0;
}

export function getSelectedColumnDatatype({
  factTable,
  column,
  excludeDeleted = false,
}: {
  factTable: Pick<FactTableInterface, "columns"> | null;
  column: string;
  excludeDeleted?: boolean;
}): FactTableColumnType | undefined {
  if (!factTable) return undefined;

  // Might be a JSON column, look at nested field
  const parts = column.split(".");
  if (parts.length > 1) {
    const col = factTable.columns.find((c) => c.column === parts[0]);
    if (col?.datatype === "json" && (!excludeDeleted || !col?.deleted)) {
      const field = col.jsonFields?.[parts.slice(1).join(".")];
      if (field) {
        return field.datatype;
      }
    }
  }

  const col = factTable.columns.find((c) => c.column === column);
  if (excludeDeleted && (!col || col.deleted)) return undefined;

  return col?.datatype;
}

export function getUserIdTypes(
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  useDenominator?: boolean,
): string[] {
  if (isFactMetric(metric)) {
    const factTable = factTableMap.get(
      useDenominator
        ? metric.denominator?.factTableId || ""
        : metric.numerator.factTableId,
    );
    return factTable?.userIdTypes || [];
  }

  return metric.userIdTypes || [];
}

export interface SliceMetricInfo {
  isSliceMetric: boolean;
  baseMetricId: string;
  sliceLevels: SliceLevelsData[];
}

/**
 * Parses a slice query string (e.g., "dim:browser=Chrome&dim:country=AU")
 * and returns the slice levels with datatypes.
 */
export function parseSliceQueryString(
  queryString: string,
  factTableMap?: Record<string, FactTableInterface>,
): SliceLevelsData[] {
  const sliceLevels: SliceLevelsData[] = [];
  const params = new URLSearchParams(queryString);

  for (const [key, value] of params.entries()) {
    if (key.startsWith("dim:")) {
      const column = decodeURIComponent(key.substring(4)); // Remove 'dim:' prefix
      const level = value === "" ? null : decodeURIComponent(value);
      // Look up datatype from factTableMap if available
      let datatype: "string" | "boolean" = "string";
      if (factTableMap) {
        for (const factTable of Object.values(factTableMap)) {
          const columnInfo = factTable.columns.find(
            (col) => col.column === column,
          );
          if (columnInfo) {
            datatype = columnInfo.datatype === "boolean" ? "boolean" : "string";
            break;
          }
        }
      }

      sliceLevels.push({
        column: column,
        datatype,
        levels: level ? [level] : [],
      });
    }
  }

  return sliceLevels;
}

export function isSliceTagSelectAll(tagId: string): {
  isSelectAll: boolean;
  column?: string;
} {
  // Handle "select all" format: dim:column (no equals sign)
  if (!tagId.includes("=")) {
    const columnMatch = tagId.match(/^dim:(.+)$/);
    if (columnMatch) {
      return {
        isSelectAll: true,
        column: decodeURIComponent(columnMatch[1]),
      };
    }
  }
  return { isSelectAll: false };
}

export function parseSliceMetricId(
  metricId: string,
  factTableMap?: Record<string, FactTableInterface>,
): SliceMetricInfo {
  const questionMarkIndex = metricId.indexOf("?");
  if (questionMarkIndex === -1) {
    return {
      isSliceMetric: false,
      baseMetricId: metricId,
      sliceLevels: [],
    };
  }

  const baseMetricId = metricId.substring(0, questionMarkIndex);
  const queryString = metricId.substring(questionMarkIndex + 1);

  const sliceLevels = parseSliceQueryString(queryString, factTableMap);

  if (sliceLevels.length === 0) {
    return {
      isSliceMetric: false,
      baseMetricId,
      sliceLevels: [],
    };
  }

  return {
    isSliceMetric: true,
    baseMetricId,
    sliceLevels: sliceLevels,
  };
}

export function getMetricLink(id: string): string {
  if (isFactMetricId(id)) return `/fact-metrics/${id}`;
  return `/metric/${id}`;
}

export function getMetricSnapshotSettings<T extends ExperimentMetricInterface>({
  metric,
  denominatorMetrics,
  experimentRegressionAdjustmentEnabled,
  organizationSettings,
  metricOverrides,
}: {
  metric: T;
  denominatorMetrics: MetricInterface[];
  experimentRegressionAdjustmentEnabled: boolean;
  organizationSettings?: Partial<OrganizationSettings>; // can be RA and prior settings from a snapshot of org settings
  metricOverrides?: MetricOverride[];
}): {
  newMetric: T;
  denominatorMetrics: MetricInterface[];
  metricSnapshotSettings: MetricSnapshotSettings;
} {
  const newMetric = cloneDeep<T>(metric);

  // start with default RA settings
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = false;
  let regressionAdjustmentDays = DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
  let regressionAdjustmentReason = "";

  // get RA settings from organization
  if (organizationSettings?.regressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
    regressionAdjustmentDays =
      organizationSettings?.regressionAdjustmentDays ??
      regressionAdjustmentDays;
  }
  if (experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = true;
  }

  // get RA settings from metric
  if (metric?.regressionAdjustmentOverride) {
    regressionAdjustmentEnabled = !!metric?.regressionAdjustmentEnabled;
    regressionAdjustmentDays =
      metric?.regressionAdjustmentDays ?? DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
    if (!regressionAdjustmentEnabled) {
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "disabled in metric settings";
    }
  }

  // experiment kill switch
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
    regressionAdjustmentAvailable = true;
    regressionAdjustmentReason = "disabled in experiment";
  }

  // start with default prior settings
  const metricPriorSettings = {
    properPrior: false,
    properPriorMean: 0,
    properPriorStdDev: DEFAULT_PROPER_PRIOR_STDDEV,
  };

  // get prior settings from organization
  if (organizationSettings?.metricDefaults?.priorSettings) {
    metricPriorSettings.properPrior =
      organizationSettings.metricDefaults.priorSettings.proper;
    metricPriorSettings.properPriorMean =
      organizationSettings.metricDefaults.priorSettings.mean;
    metricPriorSettings.properPriorStdDev =
      organizationSettings.metricDefaults.priorSettings.stddev;
  }

  // get prior settings from metric
  if (metric.priorSettings.override) {
    metricPriorSettings.properPrior = metric.priorSettings.proper;
    metricPriorSettings.properPriorMean = metric.priorSettings.mean;
    metricPriorSettings.properPriorStdDev = metric.priorSettings.stddev;
  }

  // get RA and prior settings from metric override
  if (metricOverrides) {
    // For slice metrics, use the base metric ID for lookups
    const { baseMetricId } = parseSliceMetricId(metric.id);
    const metricOverride = metricOverrides.find((mo) => mo.id === baseMetricId);

    // RA override
    if (metricOverride?.regressionAdjustmentOverride) {
      regressionAdjustmentEnabled =
        !!metricOverride?.regressionAdjustmentEnabled;
      regressionAdjustmentDays =
        metricOverride?.regressionAdjustmentDays ?? regressionAdjustmentDays;
      if (!regressionAdjustmentEnabled) {
        regressionAdjustmentAvailable = false;
        if (!metric.regressionAdjustmentEnabled) {
          regressionAdjustmentReason =
            "disabled in metric settings and metric override";
        } else {
          regressionAdjustmentReason = "disabled by metric override";
        }
      } else {
        regressionAdjustmentAvailable = true;
        regressionAdjustmentReason = "";
      }
    }

    // prior override
    if (metricOverride?.properPriorOverride) {
      metricPriorSettings.properPrior =
        metricOverride?.properPriorEnabled ?? metricPriorSettings.properPrior;
      metricPriorSettings.properPriorMean =
        metricOverride?.properPriorMean ?? metricPriorSettings.properPriorMean;
      metricPriorSettings.properPriorStdDev =
        metricOverride?.properPriorStdDev ??
        metricPriorSettings.properPriorStdDev;
    }
  }

  // final gatekeeping for RA
  if (regressionAdjustmentEnabled) {
    if (metric && isFactMetric(metric) && quantileMetricType(metric)) {
      // is this a fact quantile metric?
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "quantile metrics not supported";
    }
    if (metric?.denominator) {
      // is this a classic "ratio" metric (denominator unsupported type)?
      const denominator = denominatorMetrics.find(
        (m) => m.id === metric?.denominator,
      );
      if (denominator && !isBinomialMetric(denominator)) {
        regressionAdjustmentEnabled = false;
        regressionAdjustmentAvailable = false;
        regressionAdjustmentReason = `denominator is ${denominator.type}. CUPED available for ratio metrics only if based on fact tables.`;
      }
    }
    if (metric && !isFactMetric(metric) && metric?.aggregation) {
      regressionAdjustmentEnabled = false;
      regressionAdjustmentAvailable = false;
      regressionAdjustmentReason = "custom aggregation";
    }
  }

  regressionAdjustmentDays = regressionAdjustmentEnabled
    ? regressionAdjustmentDays
    : 0;

  newMetric.regressionAdjustmentEnabled = regressionAdjustmentEnabled;
  newMetric.regressionAdjustmentDays = regressionAdjustmentDays;

  return {
    newMetric,
    denominatorMetrics,
    metricSnapshotSettings: {
      metric: newMetric.id,
      ...metricPriorSettings,
      regressionAdjustmentEnabled,
      regressionAdjustmentAvailable,
      regressionAdjustmentDays,
      regressionAdjustmentReason,
    },
  };
}

export function getAllMetricSettingsForSnapshot({
  allExperimentMetrics,
  denominatorMetrics,
  orgSettings,
  experimentRegressionAdjustmentEnabled,
  experimentMetricOverrides = [],
  datasourceType,
  hasRegressionAdjustmentFeature,
}: {
  allExperimentMetrics: (ExperimentMetricInterface | null)[];
  denominatorMetrics: MetricInterface[];
  orgSettings: OrganizationSettings;
  experimentRegressionAdjustmentEnabled?: boolean;
  experimentMetricOverrides?: MetricOverride[];
  datasourceType?: DataSourceInterfaceWithParams["type"];
  hasRegressionAdjustmentFeature: boolean;
}) {
  const settingsForSnapshotMetrics: MetricSnapshotSettings[] = [];
  let regressionAdjustmentAvailable = true;
  let regressionAdjustmentEnabled = true;
  let regressionAdjustmentHasValidMetrics = false;
  if (allExperimentMetrics.length === 0) {
    regressionAdjustmentHasValidMetrics = true; // avoid awkward UI warning
  }
  for (const metric of allExperimentMetrics) {
    if (!metric) continue;
    const { metricSnapshotSettings } = getMetricSnapshotSettings({
      metric: metric,
      denominatorMetrics: denominatorMetrics,
      experimentRegressionAdjustmentEnabled:
        experimentRegressionAdjustmentEnabled ??
        DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      organizationSettings: orgSettings,
      metricOverrides: experimentMetricOverrides,
    });
    if (metricSnapshotSettings.regressionAdjustmentEnabled) {
      regressionAdjustmentEnabled = true;
    }
    if (metricSnapshotSettings.regressionAdjustmentAvailable) {
      regressionAdjustmentHasValidMetrics = true;
    }
    settingsForSnapshotMetrics.push(metricSnapshotSettings);
  }
  if (!experimentRegressionAdjustmentEnabled) {
    regressionAdjustmentEnabled = false;
  }
  if (
    !datasourceType ||
    datasourceType === "google_analytics" ||
    datasourceType === "mixpanel"
  ) {
    // these do not implement getExperimentMetricQuery
    regressionAdjustmentAvailable = false;
    regressionAdjustmentEnabled = false;
  }
  if (!hasRegressionAdjustmentFeature) {
    regressionAdjustmentEnabled = false;
  }
  return {
    regressionAdjustmentAvailable,
    regressionAdjustmentEnabled,
    regressionAdjustmentHasValidMetrics,
    settingsForSnapshotMetrics,
  };
}

export function isExpectedDirection(
  stats: SnapshotMetric,
  metric: { inverse?: boolean },
): boolean {
  const expected: number = stats?.expected ?? 0;
  if (metric.inverse) {
    return expected < 0;
  }
  return expected > 0;
}

export function isStatSig(pValue: number, pValueThreshold: number): boolean {
  return pValue < pValueThreshold;
}

export function shouldHighlight({
  metric,
  baseline,
  stats,
  hasEnoughData,
  belowMinChange,
}: {
  metric: { id: string };
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  hasEnoughData: boolean;
  belowMinChange: boolean;
}): boolean {
  return !!(
    metric &&
    baseline?.value &&
    stats?.value &&
    hasEnoughData &&
    !belowMinChange
  );
}

export function getMetricSampleSize(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricInterface,
): { baselineValue?: number; variationValue?: number } {
  return quantileMetricType(metric)
    ? {
        baselineValue: baseline?.stats?.count,
        variationValue: stats?.stats?.count,
      }
    : { baselineValue: baseline.value, variationValue: stats.value };
}

export function hasEnoughData(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: ExperimentMetricInterface,
  metricDefaults: MetricDefaults,
): boolean {
  const { baselineValue, variationValue } = getMetricSampleSize(
    baseline,
    stats,
    metric,
  );
  if (!baselineValue || !variationValue) return false;

  const minSampleSize =
    metric.minSampleSize ?? metricDefaults.minimumSampleSize ?? 0;

  return Math.max(baselineValue, variationValue) >= minSampleSize;
}

export function isSuspiciousUplift(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { maxPercentChange?: number },
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
): boolean {
  if (!baseline?.cr || !stats?.cr || !stats?.expected) return false;

  const maxPercentChange =
    metric.maxPercentChange ?? metricDefaults?.maxPercentageChange ?? 0;

  if (differenceType === "relative") {
    return Math.abs(stats.expected) >= maxPercentChange;
  } else if (differenceType === "absolute") {
    return (
      Math.abs(stats.expected ?? 0) / Math.abs(baseline.cr) >= maxPercentChange
    );
  } else {
    // This means scaled impact could show up as suspicious even when
    // it doesn't show up for other difference types if CUPED is applied
    // and CUPED causes the value to cross the threshold
    return (
      Math.abs(stats.cr - baseline.cr) / Math.abs(baseline.cr) >=
      maxPercentChange
    );
  }
}

export function isBelowMinChange(
  baseline: SnapshotMetric,
  stats: SnapshotMetric,
  metric: { minPercentChange?: number },
  metricDefaults: MetricDefaults,
  differenceType: DifferenceType,
): boolean {
  if (!baseline?.cr || !stats?.cr || !stats?.expected) return false;

  const minPercentChange =
    metric.minPercentChange ?? metricDefaults.minPercentageChange ?? 0;

  if (differenceType === "relative") {
    return Math.abs(stats.expected) < minPercentChange;
  } else if (differenceType === "absolute") {
    return Math.abs(stats.expected) / Math.abs(baseline.cr) < minPercentChange;
  } else {
    // This means scaled impact could show up as too small even it is
    // large enough for other difference types if CUPED is applied
    // and CUPED causes the value to cross the threshold
    return (
      Math.abs(stats.cr - baseline.cr) / Math.abs(baseline.cr) <
      minPercentChange
    );
  }
}

export function getMetricResultStatus({
  metric,
  metricDefaults,
  baseline,
  stats,
  ciLower,
  ciUpper,
  pValueThreshold,
  statsEngine,
  differenceType,
}: {
  metric: ExperimentMetricInterface;
  metricDefaults: MetricDefaults;
  baseline: SnapshotMetric;
  stats: SnapshotMetric;
  ciLower: number;
  ciUpper: number;
  pValueThreshold: number;
  statsEngine: StatsEngine;
  differenceType: DifferenceType;
}) {
  const directionalStatus: "winning" | "losing" =
    (stats.expected ?? 0) * (metric.inverse ? -1 : 1) > 0
      ? "winning"
      : "losing";

  const enoughData = hasEnoughData(baseline, stats, metric, metricDefaults);
  const belowMinChange = isBelowMinChange(
    baseline,
    stats,
    metric,
    metricDefaults,
    differenceType,
  );
  const _shouldHighlight = shouldHighlight({
    metric,
    baseline,
    stats,
    hasEnoughData: enoughData,
    belowMinChange,
  });

  let significant: boolean;
  let significantUnadjusted: boolean;
  if (statsEngine === "bayesian") {
    if (
      (stats.chanceToWin ?? 0) > ciUpper ||
      (stats.chanceToWin ?? 0) < ciLower
    ) {
      significant = true;
      significantUnadjusted = true;
    } else {
      significant = false;
      significantUnadjusted = false;
    }
  } else {
    significant = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      pValueThreshold,
    );
    significantUnadjusted = isStatSig(stats.pValue ?? 1, pValueThreshold);
  }

  let resultsStatus: "won" | "lost" | "draw" | "" = "";
  if (statsEngine === "bayesian") {
    if (_shouldHighlight && (stats.chanceToWin ?? 0.5) > ciUpper) {
      resultsStatus = "won";
    } else if (_shouldHighlight && (stats.chanceToWin ?? 0.5) < ciLower) {
      resultsStatus = "lost";
    }
    if (
      enoughData &&
      belowMinChange &&
      ((stats.chanceToWin ?? 0.5) > ciUpper ||
        (stats.chanceToWin ?? 0.5) < ciLower)
    ) {
      resultsStatus = "draw";
    }
  } else {
    if (_shouldHighlight && significant && directionalStatus === "winning") {
      resultsStatus = "won";
    } else if (
      _shouldHighlight &&
      significant &&
      directionalStatus === "losing"
    ) {
      resultsStatus = "lost";
    } else if (enoughData && significant && belowMinChange) {
      resultsStatus = "draw";
    }
  }

  let clearSignalResultsStatus: "won" | "lost" | "" = "";
  // TODO make function of existing thresholds
  if (statsEngine === "bayesian") {
    if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) > Math.max(0.999, ciUpper)
    ) {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      (stats.chanceToWin ?? 0.5) < Math.min(0.001, ciLower)
    ) {
      clearSignalResultsStatus = "lost";
    }
  } else {
    const clearStatSig = isStatSig(
      stats.pValueAdjusted ?? stats.pValue ?? 1,
      Math.min(pValueThreshold, 0.001),
    );
    if (_shouldHighlight && clearStatSig && directionalStatus === "winning") {
      clearSignalResultsStatus = "won";
    } else if (
      _shouldHighlight &&
      clearStatSig &&
      directionalStatus === "losing"
    ) {
      clearSignalResultsStatus = "lost";
    }
  }
  let guardrailSafeStatus = false;
  if (stats.ci) {
    const ciLowerGuardrail = stats.ci?.[0] ?? Number.NEGATIVE_INFINITY;
    const ciUpperGuardrail = stats.ci?.[1] ?? Number.POSITIVE_INFINITY;
    const guardrailChanceToWin =
      stats.chanceToWin ??
      chanceToWinFlatPrior(
        stats.expected ?? 0,
        ciLowerGuardrail,
        ciUpperGuardrail,
        pValueThreshold,
        metric.inverse,
      );
    guardrailSafeStatus = guardrailChanceToWin > 1 - DEFAULT_GUARDRAIL_ALPHA;
  }
  return {
    shouldHighlight: _shouldHighlight,
    belowMinChange,
    significant,
    significantUnadjusted,
    directionalStatus,
    resultsStatus,
    clearSignalResultsStatus,
    guardrailSafeStatus,
  };
}

export function chanceToWinFlatPrior(
  expected: number,
  lower: number,
  upper: number,
  pValueThreshold: number,
  inverse: boolean = false,
): number {
  if (
    lower === Number.NEGATIVE_INFINITY &&
    upper === Number.POSITIVE_INFINITY
  ) {
    return 0;
  }
  const confidenceIntervalType =
    lower === Number.NEGATIVE_INFINITY
      ? "oneSidedLesser"
      : upper === Number.POSITIVE_INFINITY
        ? "oneSidedGreater"
        : "twoSided";
  const halfwidth =
    confidenceIntervalType === "twoSided"
      ? 0.5 * (upper - lower)
      : confidenceIntervalType === "oneSidedGreater"
        ? expected - lower
        : upper - expected;
  const numTails = confidenceIntervalType === "twoSided" ? 2 : 1;
  const zScore = normal.quantile(1 - pValueThreshold / numTails, 0, 1);
  const s = halfwidth / zScore;
  if (s === 0) {
    if (expected === 0) {
      return 0;
    }
    const chanceToWin = expected > 0;
    return inverse ? 1 - +chanceToWin : +chanceToWin;
  }
  const ctwInverse = normal.cdf(-expected / s, 0, 1);
  if (inverse) {
    return ctwInverse;
  }
  return 1 - ctwInverse;
}

// get all metric ids from an experiment, excluding ephemeral metrics (slices)
export function getAllMetricIdsFromExperiment(
  exp: {
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    activationMetric?: string | null;
  },
  includeActivationMetric: boolean,
  metricGroups: MetricGroupInterface[],
) {
  return Array.from(
    new Set(
      expandMetricGroups(
        [
          ...(exp.goalMetrics || []),
          ...(exp.secondaryMetrics || []),
          ...(exp.guardrailMetrics || []),
          ...(includeActivationMetric && exp.activationMetric
            ? [exp.activationMetric]
            : []),
        ],
        metricGroups,
      ),
    ),
  );
}

// Extracts all metric ids from an experiment, including ephemeral metrics (slices)
// NOTE: The expandedMetricMap should be expanded with slice metrics via expandAllSliceMetricsInMap() before calling this function
export function getAllExpandedMetricIdsFromExperiment({
  exp,
  expandedMetricMap,
  includeActivationMetric = true,
  metricGroups = [],
}: {
  exp: {
    goalMetrics?: string[];
    secondaryMetrics?: string[];
    guardrailMetrics?: string[];
    activationMetric?: string | null;
  };
  expandedMetricMap: Map<string, ExperimentMetricInterface>;
  includeActivationMetric?: boolean;
  metricGroups?: MetricGroupInterface[];
}): string[] {
  const baseMetricIds = getAllMetricIdsFromExperiment(
    exp,
    includeActivationMetric,
    metricGroups,
  );
  const expandedMetricIds = new Set<string>(baseMetricIds);

  // Add all slice metrics that are already in the expandedMetricMap
  // This includes both standard and custom dimension metrics
  expandedMetricMap.forEach((_, metricId) => {
    // Check if this is a dimension metric (contains dim: parameter)
    if (/[?&]dim:/.test(metricId)) {
      expandedMetricIds.add(metricId);
    }
  });

  return Array.from(expandedMetricIds);
}

export interface SliceLevelsData {
  column: string;
  datatype: "string" | "boolean";
  levels: string[];
}

// For building slice metric rows (FE)
export interface SliceDataForMetric {
  id: string; // Format: `${parentId}?dim:${encodedColumnId}=${encodedValue}` or `${parentId}?dim:${encodedColumnId}=` for "other"
  name: string; // Format: `${parentName} (${columnName}: ${value})` or `${parentName} (${columnName}: other)`
  description: string;
  sliceLevels: SliceLevelsData[];
  allSliceLevels: string[];
}

// Creates auto slice data for a fact metric based on the metric's metricAutoSlices
// Used for FE: row generation, slice filtering/expansion
export function createAutoSliceDataForMetric({
  parentMetric,
  factTable,
  includeOther = true,
}: {
  parentMetric: ExperimentMetricInterface | null | undefined;
  factTable: FactTableInterface | null | undefined;
  includeOther?: boolean;
}): SliceDataForMetric[] {
  // Sanity checks
  if (!parentMetric || !isFactMetric(parentMetric)) return [];
  if (!factTable) return [];

  // Cast to FactMetricInterface after type check
  const factMetric = parentMetric as FactMetricInterface;
  if (!factMetric.metricAutoSlices?.length) return [];

  const sliceData: SliceDataForMetric[] = [];

  // Get the intersection of metricAutoSlices with fact table auto slice columns
  const factTableAutoSliceColumns = factTable.columns.filter(
    (col) =>
      col.isAutoSliceColumn &&
      !col.deleted &&
      (col.autoSlices?.length || 0) > 0,
  );

  const autoSliceColumns = factTableAutoSliceColumns.filter((col) =>
    factMetric.metricAutoSlices?.includes(col.column),
  );

  autoSliceColumns.forEach((col) => {
    const autoSlices = col.autoSlices || [];
    const columnName = col.name || col.column;

    // For boolean columns, generate true/false slices, "null" will be handled as "other" below
    const sliceValues =
      col.datatype === "boolean" ? ["true", "false"] : autoSlices;

    // Create slice data for each slice value
    sliceValues.forEach((value) => {
      const sliceString = generateSliceString({ [col.column]: value });
      sliceData.push({
        id: `${factMetric.id}?${sliceString}`,
        name: `${factMetric.name} (${columnName}: ${value})`,
        description: `Slice analysis of ${factMetric.name} for ${columnName} = ${value}`,
        sliceLevels: [
          {
            column: col.column,
            datatype: col.datatype as "string" | "boolean",
            levels: [value],
          },
        ],
        allSliceLevels: autoSlices,
      });
    });

    // Create an "other" slice data for values not in autoSlices (includes NULL for boolean)
    if (includeOther && (autoSlices.length > 0 || col.datatype === "boolean")) {
      const sliceString = generateSliceString({ [col.column]: "" });
      sliceData.push({
        id: `${factMetric.id}?${sliceString}`,
        name: `${factMetric.name} (${columnName}: other)`,
        description: `Slice analysis of ${factMetric.name} for ${columnName} (other)`,
        sliceLevels: [
          {
            column: col.column,
            datatype: col.datatype as "string" | "boolean",
            levels: [],
          },
        ],
        allSliceLevels: autoSlices,
      });
    }
  });

  return sliceData;
}

// Creates custom slice data for a fact metric by using the experiment's customMetricSlices
export function createCustomSliceDataForMetric({
  metricId,
  metricName,
  customMetricSlices,
  factTable,
}: {
  metricId: string;
  metricName: string;
  customMetricSlices?: { slices: { column: string; levels: string[] }[] }[];
  factTable?: FactTableInterface | null;
}): SliceDataForMetric[] {
  // Sanity checks
  if (!customMetricSlices?.length) return [];

  const customSliceData: SliceDataForMetric[] = [];

  customMetricSlices.forEach((group) => {
    // Sort slices alphabetically for consistent ID generation
    const sortedSlices = group.slices.sort((a, b) =>
      a.column.localeCompare(b.column),
    );

    // Create slice levels with proper handling for boolean "null" values
    const sliceLevelsForString = sortedSlices.map((d) => {
      const column = factTable?.columns.find((col) => col.column === d.column);
      // For boolean "null" slices, use empty array to generate ?dim:col= format
      const levels =
        d.levels[0] === "null" && column?.datatype === "boolean"
          ? []
          : d.levels;
      return {
        column: d.column,
        datatype: (column?.datatype === "boolean" ? "boolean" : "string") as
          | "string"
          | "boolean",
        levels,
      };
    });

    const sliceString = generateSliceStringFromLevels(sliceLevelsForString);

    const customSliceMetric = {
      id: `${metricId}?${sliceString}`,
      name: `${metricName} (${sortedSlices.map((combo) => `${combo.column}: ${combo.levels[0] || ""}`).join(", ")})`,
      description: `Slice analysis of ${metricName} for ${sortedSlices.map((combo) => `${combo.column} = ${combo.levels[0] || ""}`).join(" and ")}`,
      sliceLevels: sortedSlices.map((d) => {
        const column = factTable?.columns.find(
          (col) => col.column === d.column,
        );
        // For boolean "null" slices, use empty array to match "other" slice format
        const levels =
          d.levels[0] === "null" && column?.datatype === "boolean"
            ? []
            : d.levels;
        return {
          column: d.column,
          datatype: (column?.datatype === "boolean" ? "boolean" : "string") as
            | "string"
            | "boolean",
          levels,
        };
      }),
      allSliceLevels: sortedSlices.flatMap((slice) => slice.levels),
    };
    customSliceData.push(customSliceMetric);
  });

  return customSliceData;
}

export function generateSelectAllSliceString(column: string): string {
  // Generate "select all" tag format: dim:column (no equals sign)
  return `dim:${encodeURIComponent(column)}`;
}

export function generateSliceString(slices: Record<string, string>): string {
  const sortedSlices = Object.entries(slices).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  return sortedSlices
    .map(
      ([col, val]) =>
        `dim:${encodeURIComponent(col)}=${encodeURIComponent(val)}`,
    )
    .join("&");
}

export function generateSliceStringFromLevels(
  sliceLevels: SliceLevelsData[],
): string {
  const slices: Record<string, string> = {};
  sliceLevels.forEach((dl) => {
    slices[dl.column] = dl.levels[0] || "";
  });
  return generateSliceString(slices);
}

/** Minimal experiment shape for phase-level variation helpers. */
type ExperimentWithPhases = {
  phases: { variations: Variation[] }[];
};

/** Minimal phase shape for phase-level variation helpers. Accepts ExperimentPhase and ExperimentPhaseStringDates. */
export type PhaseWithVariations = {
  variationWeights?: number[];
  variations: Variation[];
};

/**
 * Returns the full list of variations for a phase.
 * Falls back to the latest phase on the experiment when phase is null/undefined.
 */
export function getVariationsForPhase(
  experiment: ExperimentWithPhases,
  phase: PhaseWithVariations | null,
): Variation[] {
  if (phase) return phase.variations;
  const lastPhase = experiment.phases[experiment.phases.length - 1];
  return lastPhase?.variations ?? [];
}

/**
 * Returns variations that are not disabled for the given phase.
 * Use for display, payload, snapshots.
 */
export function getActiveVariationsForPhase(
  experiment: ExperimentWithPhases,
  phase: PhaseWithVariations | null,
): Variation[] {
  return getVariationsForPhase(experiment, phase).filter(
    (v) => v.status === "active",
  );
}

/**
 * Returns weights for active (non-disabled) variations only.
 * Use for display, payload, snapshots.
 */
export function getActiveVariationWeightsForPhase(
  experiment: ExperimentWithPhases,
  phase: PhaseWithVariations | null,
): number[] {
  const variations = getVariationsForPhase(experiment, phase);
  const weights = getVariationWeightsForPhase(experiment, phase);
  return variations
    .map((v, i) => (v.status === "active" ? weights[i] : null))
    .filter((w): w is number => w !== null);
}

/**
 * Returns full variationWeights for the phase.
 * Falls back to equal weights when length mismatches (back compat).
 */
export function getVariationWeightsForPhase(
  experiment: ExperimentWithPhases,
  phase: PhaseWithVariations | null,
): number[] {
  const variations = getVariationsForPhase(experiment, phase);
  const phaseWeights = phase?.variationWeights ?? [];
  if (phaseWeights.length === variations.length) {
    return phaseWeights;
  }
  return getEqualWeights(variations.length);
}

// Returns n "equal" decimals rounded to 3 places that add up to 1
// The sum always adds to 1. In some cases the values are not equal.
// For example, getEqualWeights(3) returns [0.3334, 0.3333, 0.3333]
export function getEqualWeights(n: number, precision: number = 4): number[] {
  // The power of 10 we need to manipulate weights to the correct precision
  const multiplier = Math.pow(10, precision);

  // Naive even weighting with rounding
  // For n=3, this will result in `0.3333`
  const w = Math.round(multiplier / n) / multiplier;

  // Determine how far off we are from a sum of 1
  // For n=3, this will be 0.9999-1 = -0.0001
  const diff = w * n - 1;

  // How many of the weights do we need to add a correction to?
  // For n=3, we only have to adjust 1 of the weights to make it sum to 1
  const numCorrections = Math.round(Math.abs(diff) * multiplier);
  const delta = (diff < 0 ? 1 : -1) / multiplier;

  return (
    Array(n)
      .fill(0)
      .map((v, i) => +(w + (i < numCorrections ? delta : 0)).toFixed(precision))
      // Put the larger weights first
      .sort((a, b) => b - a)
  );
}

export async function generateTrackingKey(
  exp: Partial<ExperimentInterface>,
  getExperimentByKey?: (
    key: string,
  ) => Promise<ExperimentInterface | ExperimentInterfaceStringDates | null>,
): Promise<string> {
  // Try to generate a unique tracking key based on the experiment name
  let n = 1;
  let found: null | string = null;
  while (n < 10 && !found) {
    const key = generate(exp.name || exp.id || "", n);
    if (!getExperimentByKey || !(await getExperimentByKey(key))) {
      found = key;
    }
    n++;
  }

  // Fall back to uniqid if couldn't generate
  return found || uniqid();

  function generate(name: string, n: number): string {
    let key = ("-" + name)
      .toLowerCase()
      // Replace whitespace with hyphen
      .replace(/\s+/g, "-")
      // Get rid of all non alpha-numeric characters
      .replace(/[^a-z0-9\-_]*/g, "")
      // Remove stopwords
      .replace(
        /-((a|about|above|after|again|all|am|an|and|any|are|arent|as|at|be|because|been|before|below|between|both|but|by|cant|could|did|do|does|dont|down|during|each|few|for|from|had|has|have|having|here|how|if|in|into|is|isnt|it|its|itself|more|most|no|nor|not|of|on|once|only|or|other|our|out|over|own|same|should|shouldnt|so|some|such|that|than|then|the|there|theres|these|this|those|through|to|too|under|until|up|very|was|wasnt|we|weve|were|what|whats|when|where|which|while|who|whos|whom|why|with|wont|would)-)+/g,
        "-",
      )
      // Collapse duplicate hyphens
      .replace(/-{2,}/g, "-")
      // Remove leading and trailing hyphens
      .replace(/(^-|-$)/g, "");

    // Add number if this is not the first attempt
    if (n > 1) {
      key += "-" + n;
    }

    return key;
  }
}

export function expandMetricGroups(
  metricIds: string[],
  metricGroups: MetricGroupInterface[],
): string[] {
  const metricGroupMap = new Map(metricGroups.map((mg) => [mg.id, mg]));
  const expandedMetricIds: string[] = [];
  metricIds.forEach((id) => {
    if (metricGroupMap.has(id)) {
      expandedMetricIds.push(...(metricGroupMap.get(id)?.metrics || []));
    } else {
      expandedMetricIds.push(id);
    }
  });
  return expandedMetricIds;
}

export function isMetricJoinable(
  metricIdTypes: string[],
  userIdType: string,
  settings?: DataSourceSettings,
): boolean {
  if (metricIdTypes.includes(userIdType)) return true;

  if (settings?.queries?.identityJoins) {
    if (
      settings.queries.identityJoins.some(
        (j) =>
          j.ids.includes(userIdType) &&
          j.ids.some((jid) => metricIdTypes.includes(jid)),
      )
    ) {
      return true;
    }
  }

  // legacy support for pageviewsQuery
  if (settings?.queries?.pageviewsQuery) {
    if (
      ["user_id", "anonymous_id"].includes(userIdType) &&
      metricIdTypes.some((m) => ["user_id", "anonymous_id"].includes(m))
    ) {
      return true;
    }
  }

  return false;
}

export function adjustPValuesBenjaminiHochberg(
  indexedPValues: IndexedPValue[],
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;

  newIndexedPValues.sort((a, b) => {
    return b.pValue - a.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min((p.pValue * m) / (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue < tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function adjustPValuesHolmBonferroni(
  indexedPValues: IndexedPValue[],
): IndexedPValue[] {
  const newIndexedPValues = cloneDeep<IndexedPValue[]>(indexedPValues);
  const m = newIndexedPValues.length;
  newIndexedPValues.sort((a, b) => {
    return a.pValue - b.pValue;
  });
  newIndexedPValues.forEach((p, i) => {
    newIndexedPValues[i].pValue = Math.min(p.pValue * (m - i), 1);
  });

  let tempval = newIndexedPValues[0].pValue;
  for (let i = 1; i < m; i++) {
    if (newIndexedPValues[i].pValue > tempval) {
      tempval = newIndexedPValues[i].pValue;
    } else {
      newIndexedPValues[i].pValue = tempval;
    }
  }
  return newIndexedPValues;
}

export function setAdjustedPValuesOnResults(
  results: ExperimentReportResultDimension[],
  nonGuardrailMetrics: string[],
  adjustment: PValueCorrection,
): void {
  if (!adjustment) {
    return;
  }

  let indexedPValues: IndexedPValue[] = [];
  results.forEach((r, i) => {
    r.variations.forEach((v, j) => {
      nonGuardrailMetrics.forEach((m) => {
        const pValue = v.metrics[m]?.pValue;
        if (pValue !== undefined) {
          indexedPValues.push({
            pValue: pValue,
            index: [i, j, m],
          });
        }
      });
    });
  });

  if (indexedPValues.length === 0) {
    return;
  }

  if (adjustment === "benjamini-hochberg") {
    indexedPValues = adjustPValuesBenjaminiHochberg(indexedPValues);
  } else if (adjustment === "holm-bonferroni") {
    indexedPValues = adjustPValuesHolmBonferroni(indexedPValues);
  }

  // modify results in place
  indexedPValues.forEach((ip) => {
    const ijk = ip.index;
    results[ijk[0]].variations[ijk[1]].metrics[ijk[2]].pValueAdjusted =
      ip.pValue;
  });
  return;
}

export function adjustedCI(
  adjustedPValue: number,
  lift: number | undefined,
  pValueThreshold: number,
): [number, number] {
  if (!lift) return [0, 0];
  const zScore = normal.quantile(1 - pValueThreshold / 2, 0, 1);
  const adjStdDev = Math.abs(
    lift / normal.quantile(1 - adjustedPValue / 2, 0, 1),
  );
  const width = zScore * adjStdDev;
  return [lift - width, lift + width];
}

export function setAdjustedCIs(
  results: ExperimentReportResultDimension[],
  pValueThreshold: number,
): void {
  results.forEach((r) => {
    r.variations.forEach((v) => {
      for (const key in v.metrics) {
        const pValueAdjusted = v.metrics[key].pValueAdjusted;
        const uplift = v.metrics[key].uplift;
        const ci = v.metrics[key].ci;
        if (
          pValueAdjusted === undefined ||
          uplift === undefined ||
          ci === undefined
        ) {
          continue;
        }

        const adjCI = getAdjustedCI(
          pValueAdjusted,
          uplift.mean,
          pValueThreshold,
          ci,
        );
        if (adjCI) {
          v.metrics[key].ciAdjusted = adjCI;
        } else {
          v.metrics[key].ciAdjusted = ci;
        }
      }
    });
  });
  return;
}

export function getAdjustedCI(
  pValueAdjusted: number,
  lift: number | undefined,
  pValueThreshold: number,
  ci: [number, number],
): [number, number] | undefined {
  // set to Inf if adjusted pValue is 1
  if (pValueAdjusted > 0.999999) {
    return [-Infinity, Infinity];
  }

  const adjCI = adjustedCI(pValueAdjusted, lift, pValueThreshold);
  // only update if CI got wider, should never get more narrow
  if (adjCI[0] < ci[0] && adjCI[1] > ci[1]) {
    return adjCI;
  } else {
    return ci;
  }
}

export function dedupeSliceMetrics(
  metrics: SliceDataForMetric[],
): SliceDataForMetric[] {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    if (seen.has(metric.id)) {
      return false;
    }
    seen.add(metric.id);
    return true;
  });
}

export function expandAllSliceMetricsInMap({
  metricMap,
  factTableMap,
  experiment,
  metricGroups = [],
}: {
  metricMap: Map<string, ExperimentMetricInterface>;
  factTableMap: FactTableMap;
  experiment: Pick<
    ExperimentInterface,
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "activationMetric"
    | "customMetricSlices"
  >;
  metricGroups?: MetricGroupInterface[];
}): void {
  // Get base metrics
  const baseMetricIds = getAllMetricIdsFromExperiment(
    experiment,
    false,
    metricGroups,
  );
  const baseMetrics = baseMetricIds.map((m) => metricMap.get(m)!);

  for (const metric of baseMetrics) {
    if (!metric) continue;
    if (!isFactMetric(metric)) continue;

    const factTable = factTableMap.get(metric.numerator.factTableId);
    if (!factTable) continue;

    // 1. Add auto slice metrics
    if (metric.metricAutoSlices?.length) {
      const autoSliceColumns = factTable.columns.filter(
        (col) =>
          col.isAutoSliceColumn &&
          !col.deleted &&
          (col.autoSlices?.length || 0) > 0 &&
          metric.metricAutoSlices?.includes(col.column),
      );

      autoSliceColumns.forEach((col) => {
        const autoSlices = col.autoSlices || [];

        // Create a metric for each auto slice
        autoSlices.forEach((value: string) => {
          const sliceString = generateSliceString({
            [col.column]: value,
          });
          const sliceMetric: ExperimentMetricInterface = {
            ...metric,
            id: `${metric.id}?${sliceString}`,
            name: `${metric.name} (${col.name || col.column}: ${value})`,
            description: `Slice analysis of ${metric.name} for ${col.name || col.column} = ${value}`,
          };
          metricMap.set(sliceMetric.id, sliceMetric);
        });

        // Create an "other" metric for values not in autoSlices (includes NULL for boolean)
        if (autoSlices.length > 0 || col.datatype === "boolean") {
          const sliceString = generateSliceString({
            [col.column]: "",
          });
          const otherMetric: ExperimentMetricInterface = {
            ...metric,
            id: `${metric.id}?${sliceString}`,
            name: `${metric.name} (${col.name || col.column}: other)`,
            description: `Slice analysis of ${metric.name} for ${col.name || col.column} = other`,
          };
          metricMap.set(otherMetric.id, otherMetric);
        }
      });
    }

    // 2. Add custom slice metrics
    if (experiment.customMetricSlices) {
      experiment.customMetricSlices.forEach((customSliceGroup) => {
        // Sort slices alphabetically for consistent ID generation
        const sortedSliceGroups = customSliceGroup.slices.sort((a, b) =>
          a.column.localeCompare(b.column),
        );

        // Verify all custom slice columns exist and are string or boolean type
        const hasAllRequiredColumns = sortedSliceGroups.every((slice) => {
          const column = factTable.columns.find(
            (col) => col.column === slice.column,
          );
          return (
            column &&
            !column.deleted &&
            (column.datatype === "string" || column.datatype === "boolean") &&
            !factTable.userIdTypes.includes(column.column)
          );
        });

        if (!hasAllRequiredColumns) return;

        // Create slice levels
        const sliceLevelsForString = sortedSliceGroups.map((d) => {
          const column = factTable.columns.find(
            (col) => col.column === d.column,
          );
          // For boolean "null" slices, use empty array to generate ?dim:col= format
          const levels =
            column?.datatype === "boolean" && d.levels[0] === "null"
              ? []
              : d.levels;
          return {
            column: d.column,
            datatype: (column?.datatype === "boolean"
              ? "boolean"
              : "string") as "string" | "boolean",
            levels,
          };
        });

        const sliceString = generateSliceStringFromLevels(sliceLevelsForString);

        const customSliceMetric: ExperimentMetricInterface = {
          ...metric,
          id: `${metric.id}?${sliceString}`,
          name: `${metric.name} (${sortedSliceGroups.map((combo) => `${combo.column}: ${combo.levels[0] || ""}`).join(", ")})`,
          description: `Slice analysis of ${metric.name} for ${sortedSliceGroups.map((combo) => `${combo.column} = ${combo.levels[0] || ""}`).join(" and ")}`,
        };
        metricMap.set(customSliceMetric.id, customSliceMetric);
      });
    }
  }
}

export function isPrecomputedDimension(dimension: string | undefined): boolean {
  return dimension?.startsWith(PRECOMPUTED_DIMENSION_PREFIX) ?? false;
}

/**
 * Returns the LookbackOverride only when both conditions are met:
 *   1. attributionModel === "lookbackOverride"
 *   2. lookbackOverride is defined
 * Use this everywhere you need to decide whether to apply a lookback override.
 */
export function getEffectiveLookbackOverride(
  attributionModel: AttributionModel | undefined,
  lookbackOverride: LookbackOverride | undefined,
): LookbackOverride | undefined {
  if (attributionModel === "lookbackOverride" && lookbackOverride) {
    return lookbackOverride;
  }
  return undefined;
}
