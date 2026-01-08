import {
  ColumnRef,
  FactMetricInterface,
  FactMetricType,
  FactTableInterface,
  MetricWindowSettings,
  MetricQuantileSettings,
} from "back-end/types/fact-table";
import {
  getColumnRefWhereClause,
  getAggregateFilters,
} from "shared/experiments";

export function indentLines(str: string, spaces: number = 2) {
  return str
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");
}

export function getWHERE({
  factTable,
  columnRef,
  windowSettings,
  quantileSettings,
  type,
}: {
  factTable: FactTableInterface | null;
  columnRef: ColumnRef | null;
  windowSettings: MetricWindowSettings;
  quantileSettings: MetricQuantileSettings;
  type: FactMetricType;
}) {
  const whereParts =
    factTable && columnRef
      ? getColumnRefWhereClause({
          factTable,
          columnRef,
          escapeStringLiteral: (s) => s.replace(/'/g, "''"),
          jsonExtract: (jsonCol, path) => `${jsonCol}.${path}`,
          evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
          showSourceComment: true,
        })
      : [];

  if (type === "retention") {
    whereParts.push(
      `-- Only after seeing the experiment + retention delay\ntimestamp >= (exposure_timestamp + '${
        windowSettings.delayValue
      } ${windowSettings.delayUnit ?? "days"}')`
    );
  } else if (windowSettings.delayValue) {
    whereParts.push(
      `-- Only after seeing the experiment + delay\ntimestamp >= (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}')`
    );
  } else {
    whereParts.push(
      `-- Only after seeing the experiment\ntimestamp >= exposure_timestamp`
    );
  }

  if (windowSettings.type === "lookback") {
    whereParts.push(
      `-- Lookback Metric Window\ntimestamp >= (NOW() - '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
    );
  } else if (windowSettings.type === "conversion") {
    if (type === "retention") {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${
          windowSettings.delayValue
        } ${windowSettings.delayUnit ?? "days"}' + '${
          windowSettings.windowValue
        } ${windowSettings.windowUnit}')`
      );
    } else if (windowSettings.delayValue) {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}' + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
      );
    } else {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`
      );
    }
  }
  if (
    type === "quantile" &&
    quantileSettings.type === "event" &&
    quantileSettings.ignoreZeros
  ) {
    whereParts.push(`-- Ignore zeros in percentile\nvalue > 0`);
  }

  return whereParts.length > 0
    ? `\nWHERE\n${indentLines(whereParts.join(" AND\n"))}`
    : "";
}

export interface PreviewSQLResult {
  sql: string;
  denominatorSQL?: string;
  experimentSQL: string;
}

export function getPreviewSQL({
  type,
  quantileSettings,
  windowSettings,
  numerator,
  denominator,
  numeratorFactTable,
  denominatorFactTable,
}: {
  type: FactMetricType;
  quantileSettings: MetricQuantileSettings;
  windowSettings: MetricWindowSettings;
  numerator: ColumnRef;
  denominator: ColumnRef | null;
  numeratorFactTable: FactTableInterface | null;
  denominatorFactTable: FactTableInterface | null;
}): PreviewSQLResult {
  const identifier =
    "`" + (numeratorFactTable?.userIdTypes?.[0] || "user_id") + "`";

  const identifierComment =
    (numeratorFactTable?.userIdTypes?.length || 0) > 1
      ? `\n  -- All of the Fact Table's identifier types are supported`
      : "";

  const numeratorName = "`" + (numeratorFactTable?.name || "Fact Table") + "`";
  const denominatorName =
    "`" + (denominatorFactTable?.name || "Fact Table") + "`";

  const numeratorCol =
    numerator.column === "$$count"
      ? "COUNT(*)"
      : numerator.column === "$$distinctUsers"
        ? "1"
        : numerator.aggregation === "count distinct"
          ? `COUNT(DISTINCT ${numerator.column})`
          : `${(numerator.aggregation ?? "sum").toUpperCase()}(${
              numerator.column
            })`;

  const denominatorCol =
    denominator?.column === "$$count"
      ? "COUNT(*)"
      : denominator?.column === "$$distinctUsers"
        ? "1"
        : numerator.aggregation === "count distinct"
          ? `-- HyperLogLog estimation used instead of COUNT DISTINCT\n  COUNT(DISTINCT ${denominator?.column})`
          : `${(denominator?.aggregation ?? "sum").toUpperCase()}(${
              denominator?.column
            })`;

  const WHERE = getWHERE({
    factTable: numeratorFactTable,
    columnRef: numerator,
    windowSettings,
    quantileSettings,
    type,
  });

  const DENOMINATOR_WHERE = getWHERE({
    factTable: denominatorFactTable,
    columnRef: denominator,
    windowSettings,
    quantileSettings,
    type,
  });

  const havingParts = getAggregateFilters({
    columnRef: {
      ...numerator,
      column: type === "proportion" ? "$$distinctUsers" : numerator.column,
    },
    column:
      numerator.aggregateFilterColumn === "$$count"
        ? `COUNT(*)`
        : `SUM(${numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });
  let HAVING =
    havingParts.length > 0
      ? `\nHAVING\n${indentLines(havingParts.join("\nAND "))}`
      : "";

  if (type === "quantile") {
    HAVING = "";
    if (quantileSettings.type === "unit" && quantileSettings.ignoreZeros) {
      HAVING = `\n-- Ignore zeros in percentile\nHAVING ${numeratorCol} > 0`;
    }
  }

  const experimentSQL = `
SELECT
  variation,
  ${
    type !== "quantile"
      ? `${
          type === "proportion" || numerator.column === "$$distinctUsers"
            ? `-- Number of users who converted`
            : `-- Total ${type === "ratio" ? "numerator" : "metric"} value`
        }
  SUM(m.value) as numerator,
  ${
    type === "ratio"
      ? `-- ${
          denominator?.column === "$$distinctusers"
            ? `Number of users who converted`
            : `Total denominator value`
        }\n  SUM(d.value)`
      : `-- Number of users in experiment\n  COUNT(*)`
  } as denominator,\n  `
      : ""
  }${
    type === "quantile"
      ? `-- Final result\n  PERCENTILE(${
          quantileSettings.ignoreZeros
            ? `m.value,`
            : `\n    -- COALESCE to include NULL in the calculation\n    COALESCE(m.value, 0),\n  `
        }  ${quantileSettings.quantile}${
          !quantileSettings.ignoreZeros ? "\n  " : ""
        })`
      : `-- Final result\n  numerator / denominator`
  } AS value
FROM
  experiment_users u
  LEFT JOIN ${
    type === "ratio" ? "numerator" : "metric"
  } m ON (m.user = u.user)${
    type === "ratio"
      ? `
  LEFT JOIN denominator d ON (d.user = u.user)`
      : ``
  }
GROUP BY variation`.trim();

  switch (type) {
    case "retention":
    case "proportion":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,
  -- Each matching user counts as 1 conversion
  1 AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim(),
        experimentSQL,
      };
    case "mean":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user
`.trim(),
        experimentSQL,
      };
    case "ratio":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,${
          numerator.column === "$$distinctUsers"
            ? `\n  -- Each matching user counts as 1 conversion`
            : ""
        }
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim(),
        denominatorSQL: `
SELECT${identifierComment}
  ${identifier} AS user,${
          denominator?.column === "$$distinctUsers"
            ? `\n  -- Each matching user counts as 1 conversion`
            : ""
        }
  ${denominatorCol} AS value
FROM
  ${denominatorName}${DENOMINATOR_WHERE}
GROUP BY user
`.trim(),
        experimentSQL,
      };
    case "quantile":
      return {
        sql:
          quantileSettings.type === "unit"
            ? `
SELECT${identifierComment}
  ${identifier} AS user,
  ${numeratorCol} AS value
FROM
  ${numeratorName}${WHERE}
GROUP BY user${HAVING}
`.trim()
            : `
SELECT${identifierComment}
  ${identifier} AS user,
  \`${numerator.column}\` AS value
FROM
  ${numeratorName}${WHERE}
`.trim(),
        experimentSQL,
      };
  }
}

export function getFactMetricSQL(
  factMetric: Partial<FactMetricInterface> | null | undefined,
  getFactTableById: (id: string) => FactTableInterface | null
): PreviewSQLResult | null {
  if (!factMetric || !factMetric.metricType) return null;

  try {
    const numerator = factMetric.numerator as ColumnRef | undefined;
    const denominator = factMetric.denominator as ColumnRef | undefined;
    const windowSettings = (factMetric.windowSettings || {}) as MetricWindowSettings;
    const quantileSettings = (factMetric.quantileSettings || {
      type: "event",
      quantile: 0.5,
      ignoreZeros: false,
    }) as MetricQuantileSettings;

    if (!numerator?.factTableId) return null;

    const numeratorFactTable = getFactTableById(numerator.factTableId);
    const denominatorFactTable = denominator?.factTableId
      ? getFactTableById(denominator.factTableId)
      : null;

    return getPreviewSQL({
      type: factMetric.metricType as FactMetricType,
      quantileSettings,
      windowSettings,
      numerator,
      denominator: denominator || null,
      numeratorFactTable,
      denominatorFactTable,
    });
  } catch (error) {
    console.error("Failed to generate fact metric SQL:", error);
    return null;
  }
}
