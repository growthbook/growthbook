import { Draft, Join, TranslateContext } from "./metrics";
import {
  BulkImportPayload,
  DbtSemanticModel,
  FactTableColumn,
  FactTableData,
} from "./types";
import {
  findDim,
  gbMeta,
  isIdent,
  omit,
  qualify,
  tagsOf,
  Unsupported,
} from "./util";

const describe = (c: FactTableColumn) =>
  c.isVirtual
    ? `${c.datatype} expression \`${c.sql}\``
    : `${c.datatype} column`;

interface TableDraft {
  id: string;
  model: DbtSemanticModel;
  timeDim: string;
  joins: Map<string, Join>;
  columns: Map<string, FactTableColumn>;
}

// Places each draft on a fact table, builds that table's SQL, and finalizes the metrics.
export function planTables(
  ctx: TranslateContext,
  drafts: Draft[],
): Pick<BulkImportPayload, "factTables" | "factMetrics"> {
  const { opts, warnings } = ctx;

  // One table per (model, time dim, exact join set): a metric's table depends only on itself.
  const tables = new Map<string, TableDraft>();
  // Names joined by "__" are ambiguous once a name contains "__" itself.
  const identities = new Map<string, string>();
  const collided = new Set<string>();
  for (const d of drafts) {
    for (const { usage: u } of d.refs) {
      const { model, timeDim } = u;
      const parts = [model.name];
      if (timeDim !== model.defaults?.agg_time_dimension) parts.push(timeDim);
      const joins = [...u.joins.keys()].sort();
      u.factTableId = [...parts, ...joins].join("__");
      const identity = JSON.stringify([model.name, timeDim, joins]);
      if ((identities.get(u.factTableId) ?? identity) !== identity) {
        collided.add(u.factTableId);
      }
      identities.set(u.factTableId, identity);
      let t = tables.get(u.factTableId);
      if (!t) {
        t = {
          id: u.factTableId,
          model,
          timeDim,
          joins: new Map(),
          columns: new Map(),
        };
        tables.set(u.factTableId, t);
      }
      for (const [entity, j] of u.joins) {
        const tj = t.joins.get(entity) ?? { ...j, dims: new Set<string>() };
        j.dims.forEach((dim) => tj.dims.add(dim));
        t.joins.set(entity, tj);
      }
      for (const c of u.columns) {
        if (!t.columns.has(c.column)) t.columns.set(c.column, c);
      }
    }
  }

  const factTables: BulkImportPayload["factTables"] = [];
  const failedTables = new Set<string>();
  for (const t of tables.values()) {
    const model = t.model;
    try {
      if (collided.has(t.id)) {
        throw new Unsupported(
          `more than one semantic model, time dimension or join set produces this id; rename the one whose name contains "__"`,
        );
      }
      const rel = model.node_relation?.relation_name;
      if (!rel) {
        throw new Unsupported(
          `semantic model "${model.name}" has no relation_name (is it materialized?)`,
        );
      }
      const td = findDim(model, t.timeDim);
      const tsCol = td?.expr ?? t.timeDim;
      if (!td || td.type !== "time" || !isIdent(tsCol)) {
        throw new Unsupported(
          `agg_time_dimension "${t.timeDim}" must be a time dimension on a plain column`,
        );
      }
      // Measure columns carry inferred types; everything else is left for detection.
      const columns = new Map(t.columns);
      const declare = (
        column: string,
        datatype: FactTableColumn["datatype"],
      ) => {
        if (!columns.has(column)) columns.set(column, { column, datatype });
      };
      declare(tsCol, "date");
      const userIdTypes: string[] = [];
      const userIdColumns: Record<string, string> = {};
      for (const e of model.entities ?? []) {
        const idType = opts.entities?.[e.name] ?? e.name;
        if (opts.idTypes && !opts.idTypes.includes(idType)) continue;
        const col = e.expr ?? e.name;
        if (!isIdent(col)) {
          warnings.push({
            level: "note",
            resource: `fact table ${t.id}`,
            message: `entity "${e.name}" is an expression and cannot be an identifier column`,
          });
          continue;
        }
        userIdTypes.push(idType);
        if (col !== idType) userIdColumns[idType] = col;
        declare(col, "");
      }
      if (!userIdTypes.length) {
        throw new Unsupported(
          `no entity on "${model.name}" maps to a Data Source identifier type (use --entities; identifier types: ${opts.idTypes?.join(", ") ?? "unknown"})`,
        );
      }
      for (const d of model.dimensions ?? []) {
        const col = d.expr ?? d.name;
        if (isIdent(col)) declare(col, "");
      }

      // t.* already exposes these, so a joined column with the same name would be ambiguous.
      const baseCols = new Set(
        [
          ...(model.entities ?? []),
          ...(model.dimensions ?? []),
          ...(model.measures ?? []),
        ]
          .map((x) => x.expr ?? x.name)
          .concat(
            ctx.metrics
              .filter(
                (m) =>
                  m.type_params?.metric_aggregation_params?.semantic_model ===
                  model.name,
              )
              .map((m) => m.type_params?.expr ?? m.name),
          )
          .map((c) => c.toLowerCase()),
      );

      let sql = `SELECT * FROM ${rel}`;
      const joined = [...t.joins.keys()].sort();
      if (joined.length) {
        const selects = ["t.*"];
        const joins: string[] = [];
        for (const entity of joined) {
          const j = t.joins.get(entity);
          const rel2 = j?.target.node_relation?.relation_name;
          if (!j || !rel2) {
            throw new Unsupported(
              `semantic model "${j?.target.name}" has no relation_name`,
            );
          }
          // The joined side is a subquery so its expressions can't collide
          // with same-named base columns, and every exposed column is prefixed.
          const alias = `j_${entity}`;
          let key = `${entity}__key`;
          while (j.dims.has(key.slice(entity.length + 2))) key += "_";
          const inner = [`${j.pk.expr ?? j.pk.name} AS ${key}`];
          for (const dim of [...j.dims].sort()) {
            const d = findDim(j.target, dim);
            if (!d) continue;
            const col = `${entity}__${dim}`;
            if (baseCols.has(col.toLowerCase())) {
              throw new Unsupported(
                `joined column "${col}" has the same name as a column on "${model.name}"`,
              );
            }
            inner.push(`${d.expr ?? d.name} AS ${col}`);
            selects.push(`${alias}.${col}`);
            declare(col, "");
          }
          joins.push(
            `LEFT JOIN (SELECT ${inner.join(", ")} FROM ${rel2}) ${alias} ON ${qualify("t", j.fk.expr ?? j.fk.name)} = ${alias}.${key}`,
          );
        }
        sql = `SELECT ${selects.join(", ")} FROM ${rel} t ${joins.join(" ")}`;
      }

      const label = model.label ?? model.name;
      const data: FactTableData = {
        name: joined.length ? `${label} + ${joined.join(" + ")}` : label,
        datasource: opts.datasource,
        userIdTypes,
        // Sent even when empty, so a mapping removed in dbt is removed in GrowthBook.
        userIdColumns,
        sql,
        timestampColumn: tsCol,
        columns: [...columns.values()],
      };
      data.description = model.description ?? "";
      data.tags = tagsOf(model);
      Object.assign(data, omit(gbMeta(model), ["enabled"]));
      factTables.push({ id: t.id, data });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      failedTables.add(t.id);
      warnings.push({
        level: "skipped",
        resource: `fact table ${t.id}`,
        message: e.message,
      });
    }
  }

  const factMetrics: BulkImportPayload["factMetrics"] = [];
  const usedTables = new Set<string>();
  for (const d of drafts) {
    const name = d.metric.name;
    const bad = d.refs.find((r) => failedTables.has(r.usage.factTableId));
    if (bad) {
      warnings.push({
        level: "skipped",
        resource: `metric ${name}`,
        message: `depends on fact table "${bad.usage.factTableId}", which was skipped`,
      });
      continue;
    }
    // First declaration of a column wins. A metric needing a different type
    // (sum vs count_distinct) would be rejected by the API; one needing a
    // different definition (physical `x_vc` vs measure x's virtual column)
    // would silently read the other one.
    const conflict = d.refs.flatMap((r) =>
      r.usage.columns.flatMap((c) => {
        const stored = tables.get(r.usage.factTableId)?.columns.get(c.column);
        return stored && describe(stored) !== describe(c)
          ? [{ c, stored }]
          : [];
      }),
    )[0];
    if (conflict) {
      warnings.push({
        level: "skipped",
        resource: `metric ${name}`,
        message: `column "${conflict.c.column}" is used as ${describe(conflict.c)} here but as ${describe(conflict.stored)} by another metric on the same fact table`,
      });
      continue;
    }
    for (const r of d.refs) {
      r.ref.factTableId = r.usage.factTableId;
      usedTables.add(r.usage.factTableId);
    }
    factMetrics.push({ id: name, data: d.data });
  }

  return {
    factTables: factTables.filter((t) => usedTables.has(t.id)),
    factMetrics,
  };
}
