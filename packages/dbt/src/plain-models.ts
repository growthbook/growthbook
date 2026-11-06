import { TranslateContext } from "./metrics";
import {
  BulkImportPayload,
  DbtNode,
  FactMetricData,
  FactTableColumn,
  FactTableData,
} from "./types";
import { gbMeta, isRecord, matches, omit, tagsOf } from "./util";

// Column types the API's aggregation checks expect; other aggregations are left for detection.
const inferredTypes: Partial<Record<string, FactTableColumn["datatype"]>> = {
  sum: "number",
  max: "number",
  "count distinct": "string",
};

// Plain dbt models annotated with meta.growthbook in GrowthBook's own vocabulary.
// `taken` holds the Fact Table ids already generated from semantic models.
export function importPlainModels(
  ctx: TranslateContext,
  nodes: DbtNode[],
  taken: Set<string>,
): Pick<BulkImportPayload, "factTables" | "factMetrics"> {
  const { opts, warnings, modelsByName } = ctx;
  const factTables: BulkImportPayload["factTables"] = [];
  const factMetrics: BulkImportPayload["factMetrics"] = [];
  for (const node of nodes) {
    if (node.resource_type !== "model" || modelsByName.has(node.name)) continue;
    const meta = gbMeta(node);
    if (!Array.isArray(meta.userIdTypes)) continue;
    const tags = tagsOf(node);
    if (meta.enabled === false || matches(opts.exclude, node.name, tags))
      continue;
    const modelSelected =
      !opts.select?.length || matches(opts.select, node.name, tags);
    const entries = (Array.isArray(meta.metrics) ? meta.metrics : []).filter(
      (m) => {
        const id = isRecord(m) && typeof m.id === "string" ? m.id : null;
        if (id === null) return modelSelected;
        if (matches(opts.exclude, id, [])) return false;
        return modelSelected || matches(opts.select, id, []);
      },
    );
    if (!modelSelected && !entries.length) continue;
    if (taken.has(node.name)) {
      warnings.push({
        level: "skipped",
        resource: `fact table ${node.name}`,
        message:
          "a Fact Table generated from a semantic model already has this id",
      });
      continue;
    }
    if (!node.relation_name) {
      warnings.push({
        level: "skipped",
        resource: `fact table ${node.name}`,
        message: "model has no relation_name (is it materialized?)",
      });
      continue;
    }
    const data: FactTableData = {
      name: node.name,
      datasource: opts.datasource,
      userIdTypes: meta.userIdTypes.filter(
        (t): t is string => typeof t === "string",
      ),
      sql: `SELECT * FROM ${node.relation_name}`,
      timestampColumn: "timestamp",
      columns: [],
    };
    Object.assign(data, omit(meta, ["enabled", "metrics", "userIdTypes"]));
    // The API needs the timestamp, identifier and metric columns declared up
    // front (a metric on a column of unknown type fails validation before
    // detection can run); everything else is detected from the SQL.
    const columns = new Map<string, FactTableColumn>();
    for (const c of Array.isArray(data.columns) ? data.columns : []) {
      if (isRecord(c) && typeof c.column === "string") {
        columns.set(c.column, c as FactTableColumn);
      }
    }
    const declare = (column: string, datatype: FactTableColumn["datatype"]) => {
      if (!columns.has(column)) columns.set(column, { column, datatype });
    };
    if (typeof data.timestampColumn !== "string")
      data.timestampColumn = "timestamp";
    declare(data.timestampColumn, "date");
    const idColumns = isRecord(data.userIdColumns) ? data.userIdColumns : {};
    for (const idType of data.userIdTypes) {
      const col = idColumns[idType];
      declare(typeof col === "string" ? col : idType, "");
    }
    for (const m of entries) {
      if (
        !isRecord(m) ||
        typeof m.id !== "string" ||
        typeof m.name !== "string" ||
        typeof m.metricType !== "string"
      ) {
        warnings.push({
          level: "skipped",
          resource: `fact table ${node.name}`,
          message:
            "a meta.growthbook.metrics entry needs id, name and metricType",
        });
        continue;
      }
      const metric: FactMetricData = { name: m.name, metricType: m.metricType };
      Object.assign(metric, omit(m, ["id"]));
      for (const side of ["numerator", "denominator"] as const) {
        const ref = metric[side];
        if (isRecord(ref) && typeof ref.factTableId !== "string") {
          metric[side] = { ...ref, factTableId: node.name };
        }
        const r = metric[side];
        const datatype = inferredTypes[r?.aggregation ?? "sum"];
        if (
          r?.factTableId === node.name &&
          typeof r.column === "string" &&
          !r.column.startsWith("$$") &&
          datatype
        ) {
          declare(r.column, datatype);
        }
      }
      factMetrics.push({ id: m.id, data: metric });
    }
    data.columns = [...columns.values()];
    factTables.push({ id: node.name, data });
  }
  return { factTables, factMetrics };
}
