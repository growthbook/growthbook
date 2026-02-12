import snakeCase from "lodash/snakeCase";
import { format } from "shared/sql";
import { MetricInterface, MetricType, Condition } from "shared/types/metric";
import {
  FactTableInterface,
  FactMetricInterface,
  ColumnInterface,
  ColumnRef,
} from "shared/types/fact-table";
import {
  ParsedSelect,
  SelectItem,
  parseSelect,
  parseWhereToRowFilters,
} from "./sql-parser";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface MigrationResult {
  factTables: FactTableInterface[];
  factMetrics: FactMetricInterface[];
  unconverted: { metric: MetricInterface; reason: string }[];
}

export interface MigrationOptions {
  now?: Date;
}

interface ParsedMetricCandidate {
  metric: MetricInterface;
  parsed: ParsedSelect;
  fingerprint: string;
}

// ─── Phase 1: Filter & Parse ─────────────────────────────────────────────────
const customAggregationMap: Record<string, "sum" | "max" | "count distinct"> = {
  "count(distinct value)": "count distinct",
  "count(*)": "sum",
  "count(value)": "sum",
  "sum(value)": "sum",
  "max(value)": "max",
};

function isUnsupportedAggregation(agg: string | undefined): string | false {
  if (!agg) return false;
  if (customAggregationMap[agg.toLocaleLowerCase()]) return false;
  return `Unsupported custom aggregation: ${agg}`;
}

function mapAggregation(
  agg: string | undefined,
): "sum" | "max" | "count distinct" {
  if (!agg) return "sum";
  return customAggregationMap[agg.toLocaleLowerCase()] || "sum";
}

function isCountAggregation(agg: string | undefined): boolean {
  if (!agg) return false;
  const lower = agg.toLowerCase();
  return lower === "count(*)" || lower === "count(value)";
}

function conditionToSql(c: Condition): string {
  const col = c.column;
  const op = c.operator;
  const val = c.value;

  if (op === "~" || op === "!~") {
    // Regex operators — use raw value
    return `${col} ${op} '${val}'`;
  }
  return `${col} ${op} '${val}'`;
}

function buildParsedFromBuilder(
  metric: MetricInterface,
): ParsedSelect | string {
  if (!metric.table) {
    return "Builder metric missing table";
  }

  const selectItems: SelectItem[] = [];

  // User ID columns
  const userIdTypes = metric.userIdTypes || [];
  const userIdColumns = metric.userIdColumns || {};
  for (const uid of userIdTypes) {
    const col = userIdColumns[uid] || uid;
    selectItems.push({ expr: col, alias: uid });
  }

  // Timestamp
  const tsCol = metric.timestampColumn || "timestamp";
  selectItems.push({ expr: tsCol, alias: "timestamp" });

  // Value column (non-binomial only)
  if (metric.type !== "binomial") {
    const valCol = metric.column || "value";
    selectItems.push({ expr: valCol, alias: "value" });
  }

  // WHERE from conditions
  let where: string | null = null;
  if (metric.conditions && metric.conditions.length > 0) {
    where = metric.conditions.map(conditionToSql).join(" AND ");
  }

  return {
    ctes: [],
    select: selectItems,
    distinct: false,
    from: { table: metric.table, alias: null },
    joins: [],
    where,
    groupBy: [],
    having: null,
    orderBy: [],
    limit: null,
    offset: null,
  };
}

function filterAndParse(metrics: MetricInterface[]): {
  candidates: ParsedMetricCandidate[];
  unconverted: { metric: MetricInterface; reason: string }[];
} {
  const candidates: ParsedMetricCandidate[] = [];
  const unconverted: { metric: MetricInterface; reason: string }[] = [];

  for (const metric of metrics) {
    // Check aggregation
    const aggCheck = isUnsupportedAggregation(metric.aggregation);
    if (aggCheck) {
      unconverted.push({ metric, reason: aggCheck });
      continue;
    }

    let parsed: ParsedSelect;

    if (
      metric.queryFormat === "builder" ||
      (!metric.queryFormat && !metric.sql)
    ) {
      const result = buildParsedFromBuilder(metric);
      if (typeof result === "string") {
        unconverted.push({ metric, reason: result });
        continue;
      }
      parsed = result;
    } else {
      // SQL metric
      if (!metric.sql || !metric.sql.trim()) {
        unconverted.push({ metric, reason: "No SQL query defined" });
        continue;
      }

      const sql = metric.sql
        .replace(
          /{{\s*valueColumn\s*}}/g,
          metric.templateVariables?.valueColumn || "value",
        )
        .replace(
          /{{\s*eventName\s*}}/g,
          metric.templateVariables?.eventName || "eventName",
        )
        .replace(
          /{{\s*snakecase\s+eventName\s*}}/g,
          snakeCase(metric.templateVariables?.eventName || "eventName"),
        );

      try {
        parsed = parseSelect(sql);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        unconverted.push({ metric, reason: `Failed to parse SQL: ${msg}` });
        continue;
      }
    }

    // Check for unsupported SQL features
    if (parsed.ctes.length > 0) {
      unconverted.push({ metric, reason: "Unsupported SQL feature: CTE" });
      continue;
    }
    if (parsed.having) {
      unconverted.push({ metric, reason: "Unsupported SQL feature: HAVING" });
      continue;
    }
    if (parsed.limit) {
      unconverted.push({ metric, reason: "Unsupported SQL feature: LIMIT" });
      continue;
    }
    if (parsed.offset) {
      unconverted.push({ metric, reason: "Unsupported SQL feature: OFFSET" });
      continue;
    }
    if (parsed.distinct) {
      unconverted.push({
        metric,
        reason: "Unsupported SQL feature: DISTINCT",
      });
      continue;
    }
    if (!parsed.from) {
      unconverted.push({ metric, reason: "SQL has no FROM clause" });
      continue;
    }

    const fingerprint = buildFingerprint(metric, parsed);
    candidates.push({ metric, parsed, fingerprint });
  }

  return { candidates, unconverted };
}

// ─── Phase 2: Structural Fingerprint ─────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildFingerprint(
  metric: MetricInterface,
  parsed: ParsedSelect,
): string {
  const parts: string[] = [];

  // Datasource
  parts.push(`ds:${metric.datasource}`);

  // FROM
  if (parsed.from) {
    const table = normalize(parsed.from.table);
    const alias = parsed.from.alias ? normalize(parsed.from.alias) : "";
    parts.push(`from:${table}:${alias}`);
  }

  // JOINs sorted alphabetically
  const joinParts = parsed.joins
    .map((j) => {
      const table = normalize(j.table);
      const alias = j.alias ? normalize(j.alias) : "";
      const on = j.on ? normalize(j.on) : "";
      const using = j.using ? j.using.map(normalize).join(",") : "";
      return `${normalize(j.joinType)}|${table}:${alias}|${on}|${using}`;
    })
    .sort();

  for (const jp of joinParts) {
    parts.push(`join:${jp}`);
  }

  // GROUP BY
  if (parsed.groupBy.length > 0) {
    const groupByStr = parsed.groupBy.map(normalize).join(",");
    parts.push(`groupby:${groupByStr}`);
  }

  return parts.join("||");
}

// ─── Phase 3: Merge Groups ───────────────────────────────────────────────────

interface ClassifiedItems {
  userIdItems: Map<string, SelectItem>; // key: lowercase alias
  timestampItem: SelectItem | null;
  valueItem: SelectItem | null;
}

function classifySelectItems(
  metric: MetricInterface,
  parsed: ParsedSelect,
): ClassifiedItems {
  const userIdTypes = new Set(
    (metric.userIdTypes || []).map((u) => u.toLowerCase()),
  );
  const userIdItems = new Map<string, SelectItem>();
  let timestampItem: SelectItem | null = null;
  let valueItem: SelectItem | null = null;

  for (const item of parsed.select) {
    const alias = (item.alias || item.expr).toLowerCase();
    if (userIdTypes.has(alias)) {
      userIdItems.set(alias, item);
    } else if (alias === "timestamp") {
      timestampItem = item;
    } else if (alias === "value") {
      valueItem = item;
    }
  }

  return { userIdItems, timestampItem, valueItem };
}

interface MergedGroup {
  candidates: ParsedMetricCandidate[];
  mergedSelect: SelectItem[];
  mergedFrom: ParsedSelect["from"];
  mergedJoins: ParsedSelect["joins"];
  mergedGroupBy: string[];
  sharedWhere: string | null;
  perMetricWhere: Map<MetricInterface, string>;
  valueAliases: Map<MetricInterface, string>;
  allUserIdTypes: string[];
  conflicted: boolean;
}

function mergeGroup(candidates: ParsedMetricCandidate[]): MergedGroup {
  const first = candidates[0];
  const mergedFrom = first.parsed.from;
  const mergedJoins = first.parsed.joins;
  const mergedGroupBy = first.parsed.groupBy;

  // Classify all items
  const allClassified = candidates.map((c) => ({
    candidate: c,
    classified: classifySelectItems(c.metric, c.parsed),
  }));

  // Check for conflicting shared columns (user IDs and timestamp)
  let conflicted = false;

  // Merge user ID items
  const mergedUserIds = new Map<string, SelectItem>();
  for (const { classified } of allClassified) {
    for (const [key, item] of classified.userIdItems) {
      if (mergedUserIds.has(key)) {
        const existing = mergedUserIds.get(key)!;
        if (normalize(existing.expr) !== normalize(item.expr)) {
          conflicted = true;
        }
      } else {
        mergedUserIds.set(key, item);
      }
    }
  }

  // Merge timestamp
  let mergedTimestamp: SelectItem | null = null;
  for (const { classified } of allClassified) {
    if (classified.timestampItem) {
      if (mergedTimestamp) {
        if (
          normalize(mergedTimestamp.expr) !==
          normalize(classified.timestampItem.expr)
        ) {
          conflicted = true;
        }
      } else {
        mergedTimestamp = classified.timestampItem;
      }
    }
  }

  // Determine WHERE handling
  const whereValues = candidates.map((c) => c.parsed.where);
  const allSameWhere =
    whereValues.every((w) => w === null) ||
    whereValues.every(
      (w) => w !== null && normalize(w) === normalize(whereValues[0] || ""),
    );

  let sharedWhere: string | null = null;
  const perMetricWhere = new Map<MetricInterface, string>();

  if (allSameWhere) {
    sharedWhere = whereValues[0] || null;
  } else {
    for (const c of candidates) {
      if (c.parsed.where) {
        perMetricWhere.set(c.metric, c.parsed.where);
      }
    }
  }

  // Value columns
  const valueAliases = new Map<MetricInterface, string>();
  const metricsWithValue = allClassified.filter(
    (x) => x.classified.valueItem !== null,
  );

  // Separate hardcoded-1 metrics (use $$count) from real value metrics
  const realValueMetrics = metricsWithValue.filter(
    (x) => x.classified.valueItem!.expr.trim() !== "1",
  );
  for (const { candidate } of metricsWithValue.filter(
    (x) => x.classified.valueItem!.expr.trim() === "1",
  )) {
    valueAliases.set(candidate.metric, "$$count");
  }

  const mergedSelect: SelectItem[] = [];

  // Add user ID items
  for (const [, item] of mergedUserIds) {
    mergedSelect.push(item);
  }

  // Add timestamp
  if (mergedTimestamp) {
    mergedSelect.push(mergedTimestamp);
  }

  // Add value columns — de-duplicate by normalized expression
  const uniqueValueExprs = new Map<
    string,
    { expr: string; alias: string | null }
  >();
  for (const { classified } of realValueMetrics) {
    const item = classified.valueItem!;
    const key = normalize(item.expr);
    if (!uniqueValueExprs.has(key)) {
      uniqueValueExprs.set(key, { expr: item.expr, alias: null });
    }
  }

  if (uniqueValueExprs.size <= 1) {
    // Single unique value expression keeps alias "value"
    for (const entry of uniqueValueExprs.values()) {
      entry.alias = "value";
      mergedSelect.push({ expr: entry.expr, alias: "value" });
    }
    for (const { candidate, classified } of realValueMetrics) {
      const key = normalize(classified.valueItem!.expr);
      valueAliases.set(candidate.metric, uniqueValueExprs.get(key)!.alias!);
    }
  } else {
    // Multiple distinct expressions: value_0, value_1, etc.
    let idx = 0;
    for (const entry of uniqueValueExprs.values()) {
      const alias = `value_${idx}`;
      entry.alias = alias;
      mergedSelect.push({ expr: entry.expr, alias });
      idx++;
    }
    for (const { candidate, classified } of realValueMetrics) {
      const key = normalize(classified.valueItem!.expr);
      valueAliases.set(candidate.metric, uniqueValueExprs.get(key)!.alias!);
    }
  }

  // Collect all user ID types
  const allUserIdTypesSet = new Set<string>();
  for (const c of candidates) {
    for (const uid of c.metric.userIdTypes || []) {
      allUserIdTypesSet.add(uid);
    }
  }

  return {
    candidates,
    mergedSelect,
    mergedFrom,
    mergedJoins,
    mergedGroupBy,
    sharedWhere,
    perMetricWhere,
    valueAliases,
    allUserIdTypes: [...allUserIdTypesSet],
    conflicted,
  };
}

// ─── Phase 4: Build Output Objects ───────────────────────────────────────────

function reconstructSql(
  select: SelectItem[],
  from: ParsedSelect["from"],
  joins: ParsedSelect["joins"],
  where: string | null,
  groupBy: string[],
): string {
  const parts: string[] = [];

  // SELECT
  const selectStr = select
    .map((item) => {
      if (item.alias && item.alias !== item.expr) {
        return `${item.expr} AS ${item.alias}`;
      }
      return item.expr;
    })
    .join(", ");
  parts.push(`SELECT ${selectStr}`);

  // FROM
  if (from) {
    const fromStr = from.alias ? `${from.table} ${from.alias}` : from.table;
    parts.push(`FROM ${fromStr}`);
  }

  // JOINs
  for (const j of joins) {
    let joinStr = `${j.joinType} ${j.table}`;
    if (j.alias) joinStr += ` ${j.alias}`;
    if (j.on) joinStr += ` ON ${j.on}`;
    if (j.using) joinStr += ` USING (${j.using.join(", ")})`;
    parts.push(joinStr);
  }

  // WHERE
  if (where) {
    parts.push(`WHERE ${where}`);
  }

  // GROUP BY
  if (groupBy.length > 0) {
    parts.push(`GROUP BY ${groupBy.join(", ")}`);
  }

  return format(parts.join("\n"), "postgresql");
}

function numberFormatForType(
  metricType: MetricType,
): "" | "currency" | "time:seconds" {
  switch (metricType) {
    case "revenue":
      return "currency";
    case "duration":
      return "time:seconds";
    default:
      return "";
  }
}

function metricTypeToFactMetricType(
  t: MetricType,
  hasDenominator: boolean,
): "proportion" | "mean" | "ratio" {
  if (hasDenominator) return "ratio";
  if (t === "binomial") return "proportion";
  return "mean";
}

function buildFactTable(
  group: MergedGroup,
  factTableId: string,
  now: Date,
): FactTableInterface {
  const first = group.candidates[0].metric;
  const tableName = group.mergedFrom?.table || "unknown";

  // Merge owner, projects, tags from all metrics
  const owners = new Set<string>();
  let isAllProjects = false;
  const projects = new Set<string>();
  const tags = new Set<string>();

  for (const c of group.candidates) {
    if (c.metric.owner) owners.add(c.metric.owner);
    if (!c.metric.projects?.length) isAllProjects = true;

    for (const p of c.metric.projects || []) projects.add(p);
    for (const t of c.metric.tags || []) tags.add(t);
  }

  // Build columns
  const columns: ColumnInterface[] = [];
  const userIdTypes = new Set(group.allUserIdTypes.map((u) => u.toLowerCase()));

  for (const item of group.mergedSelect) {
    const alias = (item.alias || item.expr).toLowerCase();
    let datatype: ColumnInterface["datatype"] = "string";
    let numberFormat: ColumnInterface["numberFormat"] = "";

    if (userIdTypes.has(alias)) {
      datatype = "string";
    } else if (alias === "timestamp") {
      datatype = "date";
    } else if (alias.startsWith("value")) {
      datatype = "number";
      // Determine number format from the metric that owns this value column
      for (const c of group.candidates) {
        const valAlias = group.valueAliases.get(c.metric);
        if (valAlias && valAlias.toLowerCase() === alias) {
          // If the metric's aggregation is count distinct, the data type should be string
          if (c.metric.aggregation?.match(/count.+distinct/i)) {
            datatype = "string";
          } else {
            numberFormat = numberFormatForType(c.metric.type);
          }
          break;
        }
      }
    }

    columns.push({
      dateCreated: now,
      dateUpdated: now,
      name: item.alias || item.expr,
      description: "",
      column: item.alias || item.expr,
      datatype,
      numberFormat,
      deleted: false,
    });
  }

  return {
    id: factTableId,
    organization: first.organization,
    dateCreated: now,
    dateUpdated: now,
    name: group.candidates.length > 1 ? tableName : first.name,
    description: "",
    owner: [...owners][0] || "",
    projects: isAllProjects ? [] : [...projects],
    tags: [...tags],
    datasource: first.datasource,
    userIdTypes: group.allUserIdTypes,
    sql: reconstructSql(
      group.mergedSelect,
      group.mergedFrom,
      group.mergedJoins,
      group.sharedWhere,
      group.mergedGroupBy,
    ),
    eventName: "",
    columns,
    filters: [],
  };
}

function buildFactMetric(
  candidate: ParsedMetricCandidate,
  factTableId: string,
  valueAlias: string | undefined,
  perMetricWhere: string | undefined,
  factMetricId: string,
  now: Date,
): FactMetricInterface {
  const m = candidate.metric;
  const mType = metricTypeToFactMetricType(m.type, !!m.denominator);

  const rowFilters: ColumnRef["rowFilters"] = perMetricWhere
    ? parseWhereToRowFilters(perMetricWhere)
    : [];

  const numerator: ColumnRef = {
    factTableId,
    column:
      mType === "proportion"
        ? "$$distinctUsers"
        : isCountAggregation(m.aggregation)
          ? "$$count"
          : valueAlias || "value",
    ...(mType === "mean" ? { aggregation: mapAggregation(m.aggregation) } : {}),
    ...(rowFilters.length > 0 ? { rowFilters } : {}),
  };

  return {
    id: factMetricId,
    organization: m.organization,
    owner: m.owner || "",
    datasource: m.datasource,
    dateCreated: now,
    dateUpdated: now,
    name: m.name,
    description: m.description || "",
    tags: m.tags || [],
    projects: m.projects || [],
    inverse: m.inverse,
    metricType: mType,
    numerator,
    denominator: null,
    cappingSettings: m.cappingSettings,
    windowSettings: m.windowSettings,
    priorSettings: m.priorSettings,
    maxPercentChange: m.maxPercentChange ?? 0.5,
    minPercentChange: m.minPercentChange ?? 0.005,
    minSampleSize: m.minSampleSize ?? 150,
    winRisk: m.winRisk ?? 0.0025,
    loseRisk: m.loseRisk ?? 0.0125,
    regressionAdjustmentOverride: m.regressionAdjustmentOverride ?? false,
    regressionAdjustmentEnabled: m.regressionAdjustmentEnabled ?? false,
    regressionAdjustmentDays: m.regressionAdjustmentDays ?? 14,
    quantileSettings: null,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function migrateMetrics(
  metrics: MetricInterface[],
  options: MigrationOptions,
): MigrationResult {
  const now = options.now ?? new Date();
  const unconverted: { metric: MetricInterface; reason: string }[] = [];

  // Pre-validation: validate denominator references before parsing
  const metricsById = new Map<string, MetricInterface>();
  for (const m of metrics) {
    metricsById.set(m.id, m);
  }

  const validMetrics: MetricInterface[] = [];
  for (const m of metrics) {
    if (m.denominator) {
      const denom = metricsById.get(m.denominator);
      if (!denom) {
        unconverted.push({
          metric: m,
          reason: "Denominator metric not found in input",
        });
        continue;
      }
      if (denom.denominator) {
        unconverted.push({
          metric: m,
          reason: "Nested ratio metrics are not supported",
        });
        continue;
      }
    }
    validMetrics.push(m);
  }

  // Phase 1: Filter & Parse
  const { candidates, unconverted: parseUnconverted } =
    filterAndParse(validMetrics);
  unconverted.push(...parseUnconverted);

  // Phase 2: Group by fingerprint
  const groups = new Map<string, ParsedMetricCandidate[]>();
  for (const c of candidates) {
    const existing = groups.get(c.fingerprint) || [];
    existing.push(c);
    groups.set(c.fingerprint, existing);
  }

  // Phase 3 & 4: Merge and build (Pass 1)
  const factTables: FactTableInterface[] = [];
  const factMetrics: FactMetricInterface[] = [];
  const metricIdToColumnRef = new Map<string, ColumnRef>();
  const ratioMetricIndices: { index: number; denominatorId: string }[] = [];

  for (const [, groupCandidates] of groups) {
    const merged = mergeGroup(groupCandidates);

    if (merged.conflicted) {
      // Fall back to individual fact tables per metric
      for (const c of groupCandidates) {
        const individualMerged = mergeGroup([c]);
        const factTableId = `ft_${c.metric.id}`;
        const ft = buildFactTable(individualMerged, factTableId, now);
        factTables.push(ft);

        const factMetricId = `fact__${c.metric.id}`;
        const valAlias = individualMerged.valueAliases.get(c.metric);
        const pmw = individualMerged.perMetricWhere.get(c.metric);
        const fm = buildFactMetric(
          c,
          factTableId,
          valAlias,
          pmw,
          factMetricId,
          now,
        );
        factMetrics.push(fm);
        metricIdToColumnRef.set(c.metric.id, fm.numerator);
        if (c.metric.denominator) {
          ratioMetricIndices.push({
            index: factMetrics.length - 1,
            denominatorId: c.metric.denominator,
          });
        }
      }
    } else {
      const factTableId = `ft_${groupCandidates[0].metric.id}`;
      const ft = buildFactTable(merged, factTableId, now);
      factTables.push(ft);

      for (const c of groupCandidates) {
        const factMetricId = `fact__${c.metric.id}`;
        const valAlias = merged.valueAliases.get(c.metric);
        const pmw = merged.perMetricWhere.get(c.metric);
        const fm = buildFactMetric(
          c,
          factTableId,
          valAlias,
          pmw,
          factMetricId,
          now,
        );
        factMetrics.push(fm);
        metricIdToColumnRef.set(c.metric.id, fm.numerator);
        if (c.metric.denominator) {
          ratioMetricIndices.push({
            index: factMetrics.length - 1,
            denominatorId: c.metric.denominator,
          });
        }
      }
    }
  }

  // Pass 2: Resolve denominator references
  const indicesToRemove = new Set<number>();
  for (const { index, denominatorId } of ratioMetricIndices) {
    const denomColRef = metricIdToColumnRef.get(denominatorId);
    if (denomColRef) {
      factMetrics[index].denominator = { ...denomColRef };
    } else {
      // Denominator failed conversion — remove this ratio metric
      const fm = factMetrics[index];
      const originalMetric = metricsById.get(fm.id.replace(/^fact__/, ""));
      if (originalMetric) {
        unconverted.push({
          metric: originalMetric,
          reason: "Denominator metric could not be converted",
        });
      }
      indicesToRemove.add(index);
    }
  }

  // Remove failed ratio metrics (iterate in reverse to preserve indices)
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    factMetrics.splice(idx, 1);
  }

  return { factTables, factMetrics, unconverted };
}

export function getLegacyMetricSQL(metric: MetricInterface): string {
  if (metric.sql || metric.queryFormat === "sql") {
    return metric.sql;
  }

  const parsed = buildParsedFromBuilder(metric);

  return reconstructSql(
    parsed.select,
    parsed.from,
    parsed.joins,
    parsed.where,
    parsed.groupBy,
  );
}
