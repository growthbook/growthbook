import {
  ColumnRef,
  FactTableDefinition,
  FunnelStep,
  MetricQuantileSettings,
  MetricWindowSettings,
  StandardFactMetricInterface,
} from "shared/types/fact-table";
import {
  getAggregateFilters,
  getColumnRefWhereClause,
} from "shared/experiments";
import { createLikeStringMatchFn } from "shared/sql";
import { getFunnelAnchorStepIndex } from "shared/funnels";

// Illustrative, not real - ported from FactMetricModal.tsx's own (frozen,
// untouched) preview so the new editor's always-visible SQL tab matches its
// exact privacy behavior: it names the fact table by its GrowthBook display
// name and the metric's own already-chosen columns (both already visible
// elsewhere in this same form), but never the fact table's actual configured
// `sql` - that raw warehouse query can reference real schema/table names and
// business logic this preview has no business exposing just because a field
// changed. Pure client-side text generation, no backend call, no execution -
// contrast with PreviewPanel's "Run Preview" (rows) tab, which is a
// deliberate, on-demand action that already reveals real data by design.

function indentLines(str: string, spaces: number = 2) {
  return str
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");
}

function getWHERE({
  factTable,
  columnRef,
  windowSettings,
  quantileSettings,
  type,
}: {
  factTable: FactTableDefinition | null;
  columnRef: ColumnRef | null;
  windowSettings: MetricWindowSettings;
  quantileSettings: MetricQuantileSettings;
  type: StandardFactMetricInterface["metricType"];
}) {
  const whereParts =
    factTable && columnRef
      ? getColumnRefWhereClause({
          factTable,
          columnRef,
          escapeStringLiteral: (s) => s.replace(/'/g, "''"),
          stringMatch: createLikeStringMatchFn({
            escapeStringLiteral: (s) => s.replace(/'/g, "''"),
            emitEscapeClause: false,
          }),
          // This isn't real SQL syntax for most dialects, but it should get the point across
          jsonExtract: (jsonCol, path) => `${jsonCol}.${path}`,
          evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
          showSourceComment: true,
        })
      : [];

  if (type === "retention") {
    whereParts.push(
      `-- Only after seeing the experiment + retention delay\ntimestamp >= (exposure_timestamp + '${
        windowSettings.delayValue
      } ${windowSettings.delayUnit ?? "days"}')`,
    );
  } else if (windowSettings.delayValue) {
    whereParts.push(
      `-- Only after seeing the experiment + delay\ntimestamp >= (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}')`,
    );
  } else {
    whereParts.push(
      `-- Only after seeing the experiment\ntimestamp >= exposure_timestamp`,
    );
  }

  if (windowSettings.type === "lookback") {
    whereParts.push(
      `-- Lookback Metric Window\ntimestamp >= (NOW() - '${windowSettings.windowValue} ${windowSettings.windowUnit}')`,
    );
  } else if (windowSettings.type === "conversion") {
    if (type === "retention") {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${
          windowSettings.delayValue
        } ${windowSettings.delayUnit ?? "days"}' + '${
          windowSettings.windowValue
        } ${windowSettings.windowUnit}')`,
      );
    } else if (windowSettings.delayValue) {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.delayValue} ${windowSettings.delayUnit}' + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`,
      );
    } else {
      whereParts.push(
        `-- Conversion Metric Window\ntimestamp < (exposure_timestamp + '${windowSettings.windowValue} ${windowSettings.windowUnit}')`,
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

export type MetricPreviewSql = {
  sql: string;
  denominatorSQL?: string;
  experimentSQL: string;
};

export function getPreviewSQL({
  type,
  quantileSettings,
  windowSettings,
  numerator,
  denominator,
  numeratorFactTable,
  denominatorFactTable,
}: {
  type: StandardFactMetricInterface["metricType"];
  quantileSettings: MetricQuantileSettings;
  windowSettings: MetricWindowSettings;
  numerator: ColumnRef;
  denominator: ColumnRef | null;
  numeratorFactTable: FactTableDefinition | null;
  denominatorFactTable: FactTableDefinition | null;
}): MetricPreviewSql {
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
    type === "dailyParticipation" || numerator.column === "$$distinctDates"
      ? `COUNT(DISTINCT DATE(timestamp))`
      : numerator.column === "$$count"
        ? "COUNT(*)"
        : numerator.column === "$$distinctUsers"
          ? "1"
          : numerator.aggregation === "count distinct"
            ? `COUNT(DISTINCT ${numerator.column})`
            : `${(numerator.aggregation ?? "sum").toUpperCase()}(${
                numerator.column
              })`;
  const numeratorAdjustment =
    type === "dailyParticipation" ? "\n\t/ CEIL(days_since_exposure)" : "";

  const denominatorCol =
    denominator?.column === "$$count"
      ? "COUNT(*)"
      : denominator?.column === "$$distinctUsers"
        ? "1"
        : denominator?.column === "$$distinctDates"
          ? `COUNT(DISTINCT DATE(timestamp))`
          : denominator?.aggregation === "count distinct"
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
      // Column is often set incorrectly for proportion metrics and changed later during submit
      ...numerator,
      column:
        type === "proportion" || type === "dailyParticipation"
          ? "$$distinctUsers"
          : numerator.column,
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
    case "dailyParticipation":
      return {
        sql: `
SELECT${identifierComment}
  ${identifier} AS user,
  ${numeratorCol}${numeratorAdjustment} AS value
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
      // TODO: handle event vs user level quantiles
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

export function getFunnelPreviewSQL({
  steps,
  factTable,
  windowSettings,
}: {
  steps: FunnelStep[];
  factTable: FactTableDefinition | null;
  windowSettings: MetricWindowSettings;
}): MetricPreviewSql {
  if (!factTable || steps.length === 0) {
    return { sql: "", experimentSQL: "" };
  }

  const identifier = "`" + (factTable?.userIdTypes?.[0] || "user_id") + "`";
  const factTableName = "`" + (factTable?.name || "Fact Table") + "`";

  // Exposure, delay, and metric window bounds apply to every step, so they sit
  // on the CTE rather than being repeated in each step's filter.
  const WHERE = getWHERE({
    factTable,
    columnRef: null,
    windowSettings,
    quantileSettings: {
      type: "unit",
      quantile: 0.5,
      ignoreZeros: false,
    } as MetricQuantileSettings,
    type: "proportion",
  });

  const stepSelects = steps.map((step, i) => {
    const stepNumber = i + 1;
    // A null anchor means only optional steps precede this one, so it is
    // measured from exposure instead.
    const anchorIndex = getFunnelAnchorStepIndex(steps, i);
    const anchor =
      anchorIndex === null
        ? "exposure_timestamp"
        : `step_${anchorIndex + 1}_at`;

    const predicates = getColumnRefWhereClause({
      factTable,
      columnRef: {
        factTableId: step.factTableId,
        column: "",
        rowFilters: step.rowFilters,
      },
      escapeStringLiteral: (s) => s.replace(/'/g, "''"),
      stringMatch: createLikeStringMatchFn({
        escapeStringLiteral: (s) => s.replace(/'/g, "''"),
        emitEscapeClause: false,
      }),
      jsonExtract: (jsonCol, path) => `${jsonCol}.${path}`,
      evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
    });

    // Ordering against exposure is already covered by the CTE's WHERE.
    if (anchorIndex !== null) {
      predicates.push(`timestamp > ${anchor}`);
    }
    if (step.conversionWindow) {
      predicates.push(
        `timestamp <= ${anchor} + '${step.conversionWindow.value} ${step.conversionWindow.unit}'`,
      );
    }

    const timing = [
      ...(step.optional ? ["optional"] : []),
      anchorIndex === null ? "after exposure" : `after Step ${anchorIndex + 1}`,
      ...(step.conversionWindow
        ? [
            `within ${step.conversionWindow.value} ${step.conversionWindow.unit}`,
          ]
        : []),
    ];
    const comments = [
      `-- Step ${stepNumber}: ${step.name} (${timing.join(", ")})`,
    ];

    const skipped = steps
      .slice((anchorIndex ?? -1) + 1, i)
      .map((_, idx) => `Step ${(anchorIndex ?? -1) + 2 + idx}`);
    if (skipped.length > 0) {
      const plural = skipped.length > 1;
      comments.push(
        `-- ${skipped.join(", ")} ${plural ? "are" : "is"} optional, so ${
          plural ? "they do" : "it does"
        } not gate this step`,
      );
    }

    const as = `AS step_${stepNumber}_at`;
    let agg: string;
    if (predicates.length === 0) {
      agg = `MIN(timestamp) ${as}`;
    } else {
      const oneLine = `MIN(timestamp) FILTER (WHERE ${predicates.join(
        " AND ",
      )}) ${as}`;
      // A row filter can span lines (a long IN list, say), so keep its
      // continuation lines aligned under the predicate.
      const aligned = predicates.map((p) => p.split("\n").join("\n    "));
      agg =
        oneLine.length <= 76 && !oneLine.includes("\n")
          ? oneLine
          : `MIN(timestamp) FILTER (\n  WHERE ${aligned.join(
              "\n    AND ",
            )}\n) ${as}`;
    }

    return `${comments.join("\n")}\n${agg}`;
  });

  const cteBody = `
SELECT
  ${identifier} AS user,
${indentLines(stepSelects.join(",\n"))}
FROM
  ${factTableName}${WHERE}
GROUP BY user`.trim();

  const caseLines = steps
    .map((_, i) => {
      const n = i + 1;
      const comment =
        i === 0 ? `  -- 1 if the user reached the step in order, else 0\n` : "";
      return `${comment}  CASE WHEN f.step_${n}_at IS NOT NULL THEN 1 ELSE 0 END AS step_${n}_value`;
    })
    .join(",\n");

  const sql = `
-- Funnel metric: share of exposed users who reach each step in order.
-- Each step is measured against all exposed users, not just those who entered the funnel.
WITH funnel AS (
${indentLines(cteBody)}
)
SELECT
  u.user,
${caseLines}
FROM
  exposed_users u
  LEFT JOIN funnel f ON (f.user = u.user)`.trim();

  const sumLines = steps
    .map((_, i) => {
      const n = i + 1;
      const comment =
        i === 0
          ? `  -- Users reaching each step, out of all exposed users\n`
          : "";
      return `${comment}  SUM(step_${n}_value) AS step_${n}_conversions`;
    })
    .join(",\n");

  const finalStep = steps.length;

  const experimentSQL = `
SELECT
  variation,
${sumLines},
  COUNT(*) AS exposed_users,
  -- Overall funnel conversion = reached the final step
  SUM(step_${finalStep}_value) / COUNT(*) AS overall_conversion
FROM
  experiment_users u
  LEFT JOIN funnel f ON (f.user = u.user)
GROUP BY variation`.trim();

  return { sql, experimentSQL };
}
