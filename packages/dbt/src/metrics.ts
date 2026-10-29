import { parseRowFilter } from "./row-filter";
import {
  ColumnRef,
  DbtAggParams,
  DbtEntity,
  DbtInput,
  DbtMeasure,
  DbtMetric,
  DbtSemanticModel,
  DbtWindow,
  FactMetricData,
  FactTableColumn,
  FunnelStep,
  RowFilter,
  TranslateOptions,
  TranslateWarning,
} from "./types";
import {
  dimSql,
  filtersOf,
  findDim,
  findEntity,
  gbMeta,
  isIdent,
  matches,
  omit,
  ownsEntity,
  sqlExpr,
  tagsOf,
  toWindow,
  Unsupported,
  Window,
} from "./util";

// Read-only indexes over the manifest, plus the warnings every stage appends to.
export interface TranslateContext {
  opts: TranslateOptions;
  warnings: TranslateWarning[];
  models: DbtSemanticModel[];
  modelsByName: Map<string, DbtSemanticModel>;
  metrics: DbtMetric[];
  metricsByName: Map<string, DbtMetric>;
  measureIndex: Map<string, { model: DbtSemanticModel; measure: DbtMeasure }>;
}

interface MeasureDef {
  model: DbtSemanticModel;
  name: string;
  label: string;
  agg: string;
  expr: string;
  aggParams?: DbtAggParams | null;
  timeDim: string;
  nonAdditive: boolean;
  filters: string[];
}

export interface Join {
  target: DbtSemanticModel;
  fk: DbtEntity;
  pk: DbtEntity;
  dims: Set<string>;
}

// One measure read by one metric. Several usages collapse into one fact table.
export interface Usage {
  model: DbtSemanticModel;
  timeDim: string;
  joins: Map<string, Join>;
  columns: FactTableColumn[];
  factTableId: string;
}

interface Ref {
  ref: { factTableId: string };
  usage: Usage;
}

export interface Draft {
  metric: DbtMetric;
  data: FactMetricData;
  refs: Ref[];
}

const NESTED_AGGS = ["average", "median", "percentile"];

// Translates every selected metric into a draft whose fact table ids are filled in by planTables.
export function draftMetrics(ctx: TranslateContext): Draft[] {
  const { opts, warnings, models, modelsByName, metrics, metricsByName } = ctx;
  const { measureIndex } = ctx;

  const modelBlocked = (m: DbtSemanticModel) =>
    gbMeta(m).enabled === false || matches(opts.exclude, m.name, tagsOf(m));

  function measureDef(
    model: DbtSemanticModel,
    measure: DbtMeasure,
    filters: string[],
  ): MeasureDef {
    const timeDim =
      measure.agg_time_dimension ?? model.defaults?.agg_time_dimension;
    if (!timeDim) {
      throw new Unsupported(
        `semantic model "${model.name}" has no agg_time_dimension`,
      );
    }
    return {
      model,
      name: measure.name,
      label: measure.label ?? measure.name,
      agg: measure.agg,
      expr: measure.expr ?? measure.name,
      aggParams: measure.agg_params,
      timeDim,
      nonAdditive: (measure.non_additive_dimension ?? null) !== null,
      filters,
    };
  }

  function resolveMeasure(input: DbtInput): MeasureDef {
    const found = measureIndex.get(input.name);
    if (!found) throw new Unsupported(`measure "${input.name}" not found`);
    return measureDef(found.model, found.measure, filtersOf(input.filter));
  }

  function resolveSimple(name: string, extraFilters: string[]): MeasureDef {
    const metric = metricsByName.get(name);
    if (!metric) throw new Unsupported(`metric "${name}" not found`);
    if (metric.type !== "simple") {
      throw new Unsupported(
        `input metric "${name}" is a ${metric.type} metric; only simple metrics can be inputs`,
      );
    }
    const tp = metric.type_params ?? {};
    const filters = [...filtersOf(metric.filter), ...extraFilters];
    const p = tp.metric_aggregation_params;
    if (p) {
      const model = modelsByName.get(p.semantic_model);
      if (!model) {
        throw new Unsupported(`semantic model "${p.semantic_model}" not found`);
      }
      return measureDef(
        model,
        {
          name: metric.name,
          agg: p.agg,
          expr: tp.expr,
          label: metric.label,
          agg_params: p.agg_params,
          agg_time_dimension: p.agg_time_dimension,
          non_additive_dimension: p.non_additive_dimension,
        },
        filters,
      );
    }
    if (tp.measure) {
      const def = resolveMeasure(tp.measure);
      return {
        ...def,
        label: metric.label ?? def.label,
        filters: [...def.filters, ...filters],
      };
    }
    throw new Unsupported(
      `simple metric "${name}" has neither a measure nor aggregation params`,
    );
  }

  // Legacy cumulative/conversion inputs name a measure; everything else names a metric.
  // A measure and the metric dbt creates from it share a name, so whether an
  // input names a measure or a metric comes from the field it sits in.
  type InputKind = "measure" | "metric";
  const resolveInput = (input: DbtInput, kind: InputKind): MeasureDef =>
    kind === "metric"
      ? resolveSimple(input.name, filtersOf(input.filter))
      : resolveMeasure(input);
  type InputRef = [DbtInput, InputKind];
  const ref = (
    input: DbtInput | null | undefined,
    kind: InputKind,
  ): InputRef | null => (input ? [input, kind] : null);

  // Every input a metric reads, by role. Translation and selection both read this.
  function inputsOf(metric: DbtMetric) {
    const tp = metric.type_params ?? {};
    const c = tp.conversion_type_params;
    return {
      measure: ref(tp.measure, "measure"),
      numerator: ref(tp.numerator, "metric"),
      denominator: ref(tp.denominator, "metric"),
      cumulative:
        ref(tp.cumulative_type_params?.metric, "metric") ??
        ref(tp.measure, "measure"),
      base: ref(c?.base_metric, "metric") ?? ref(c?.base_measure, "measure"),
      conversion:
        ref(c?.conversion_metric, "metric") ??
        ref(c?.conversion_measure, "measure"),
      derived: (tp.metrics ?? []).map((m): InputRef => [m, "metric"]),
    };
  }

  const withFilters = (def: MeasureDef, filters: string[]): MeasureDef => ({
    ...def,
    filters: [...def.filters, ...filters],
  });

  const JINJA =
    /\{\{\s*(Dimension|TimeDimension|Entity|Metric)\s*\(\s*(['"])([^'"]+)\2[^}]*\)\s*\}\}/g;

  function renderFilter(template: string, usage: Usage): string {
    const model = usage.model;
    const sql = template.replace(
      JINJA,
      (match, kind: string, quote: string, ref: string) => {
        if (kind === "Entity") {
          const e = findEntity(model, ref);
          if (!e) {
            throw new Unsupported(
              `filter references entity "${ref}", which is not on "${model.name}"`,
            );
          }
          return sqlExpr(e.expr ?? e.name);
        }
        if (kind !== "Dimension") {
          throw new Unsupported(
            `filter uses ${kind}(), which has no GrowthBook equivalent`,
          );
        }
        const i = ref.indexOf("__");
        const entity =
          i === -1 ? (model.primary_entity ?? "") : ref.slice(0, i);
        const dim = i === -1 ? ref : ref.slice(i + 2);
        if (i === -1 || ownsEntity(model, entity)) {
          const d = findDim(model, dim);
          if (!d) {
            throw new Unsupported(
              `dimension "${ref}" not found on "${model.name}"`,
            );
          }
          return dimSql(d);
        }
        const fk = findEntity(model, entity);
        if (!fk) {
          throw new Unsupported(
            `filter on "${ref}" needs entity "${entity}", which "${model.name}" does not have (multi-hop joins are not supported)`,
          );
        }
        const target = models.find(
          (m) => m !== model && ownsEntity(m, entity) && findDim(m, dim),
        );
        const pk = target && findEntity(target, entity);
        if (!target || !pk) {
          throw new Unsupported(
            `no semantic model with primary entity "${entity}" defines dimension "${dim}"`,
          );
        }
        // A joined model is read too, so disabling or excluding it drops the metric.
        if (modelBlocked(target)) {
          throw new Unsupported(
            `depends on semantic model "${target.name}", which is excluded`,
          );
        }
        const join = usage.joins.get(entity) ?? {
          target,
          fk,
          pk,
          dims: new Set<string>(),
        };
        join.dims.add(dim);
        usage.joins.set(entity, join);
        return `${entity}__${dim}`;
      },
    );
    if (sql.includes("{{")) {
      throw new Unsupported(`filter "${template}" could not be translated`);
    }
    return sql;
  }

  function measureRef(def: MeasureDef): {
    usage: Usage;
    ref: ColumnRef;
    notNull: () => RowFilter;
  } {
    if (def.nonAdditive) {
      throw new Unsupported(
        `measure "${def.name}" uses non_additive_dimension, which has no GrowthBook equivalent`,
      );
    }
    const usage: Usage = {
      model: def.model,
      timeDim: def.timeDim,
      joins: new Map(),
      columns: [],
      factTableId: "",
    };
    // Pushed after the measure's own column so a measure's inferred type wins.
    const filterColumns: FactTableColumn[] = [];
    const rowFilters = def.filters.map((f): RowFilter => {
      const sql = renderFilter(f, usage);
      const parsed = parseRowFilter(sql);
      if (!parsed) return { operator: "sql_expr", values: [sql] };
      if (parsed.datatype) {
        filterColumns.push({
          column: parsed.filter.column,
          datatype: parsed.datatype,
        });
      }
      return parsed.filter;
    });
    const ref: ColumnRef = { factTableId: "" };

    const column = (datatype: FactTableColumn["datatype"]) => {
      if (isIdent(def.expr)) {
        usage.columns.push({ column: def.expr, datatype });
        return def.expr;
      }
      // The API requires virtual column ids to end in _vc.
      const name = `${def.name}_vc`;
      usage.columns.push({
        column: name,
        datatype,
        isVirtual: true,
        sql: def.expr,
      });
      return name;
    };
    // dbt's COUNT(expr) and AVG(expr) skip nulls; $$count counts rows.
    const notNull = (): RowFilter =>
      isIdent(def.expr)
        ? { operator: "not_null", column: def.expr }
        : { operator: "sql_expr", values: [`(${def.expr}) IS NOT NULL`] };
    const isKey = (def.model.entities ?? []).some(
      (e) => e.type !== "foreign" && (e.expr ?? e.name) === def.expr,
    );

    switch (def.agg) {
      case "count":
        ref.column = "$$count";
        if (!isKey) rowFilters.push(notNull());
        break;
      case "sum":
      case "average":
      case "median":
      case "percentile":
        ref.column = column("number");
        break;
      case "max":
        ref.column = column("number");
        ref.aggregation = "max";
        break;
      case "count_distinct":
        ref.column = column("string");
        ref.aggregation = "count distinct";
        break;
      case "sum_boolean": {
        const name = `${def.name}_vc`;
        usage.columns.push({
          column: name,
          datatype: "number",
          isVirtual: true,
          sql: `CASE WHEN ${def.expr} THEN 1 ELSE 0 END`,
        });
        ref.column = name;
        break;
      }
      case "min":
        throw new Unsupported(`agg "min" has no GrowthBook aggregation`);
      default:
        throw new Unsupported(`unknown agg "${def.agg}"`);
    }
    if (rowFilters.length) ref.rowFilters = rowFilters;
    usage.columns.push(...filterColumns);
    return { usage, ref, notNull };
  }

  function simpleData(def: MeasureDef): Omit<Draft, "metric"> {
    const { usage, ref, notNull } = measureRef(def);
    const data: FactMetricData = {
      name: def.label,
      metricType: "mean",
      numerator: ref,
    };
    const refs: Ref[] = [{ ref, usage }];
    if (def.agg === "average") {
      const den: ColumnRef = {
        factTableId: "",
        column: "$$count",
        rowFilters: [...(ref.rowFilters ?? []), notNull()],
      };
      refs.push({ ref: den, usage });
      return { data: { ...data, metricType: "ratio", denominator: den }, refs };
    }
    if (def.agg === "median" || def.agg === "percentile") {
      const q =
        def.agg === "median" ? 0.5 : (def.aggParams?.percentile ?? null);
      if (q === null) {
        throw new Unsupported(
          `percentile measure "${def.name}" has no percentile`,
        );
      }
      const quantile = Math.round(q * 1000) / 1000;
      if (quantile < 0.001 || quantile > 0.999) {
        throw new Unsupported(
          `percentile ${q} is outside the 0.001 to 0.999 range GrowthBook supports`,
        );
      }
      if (def.aggParams?.use_discrete_percentile) {
        warnings.push({
          level: "note",
          resource: `metric ${def.name}`,
          message: "discrete percentile is computed as a continuous quantile",
        });
      }
      return {
        data: {
          ...data,
          metricType: "quantile",
          quantileSettings: {
            type: "event",
            quantile,
            ignoreZeros: false,
          },
        },
        refs,
      };
    }
    return { data, refs };
  }

  function ratioData(
    name: string,
    num: MeasureDef,
    den: MeasureDef,
  ): Omit<Draft, "metric"> {
    for (const d of [num, den]) {
      if (NESTED_AGGS.includes(d.agg)) {
        throw new Unsupported(
          `ratio input "${d.name}" is itself a ${d.agg}; nested ratios are not supported`,
        );
      }
    }
    const n = measureRef(num);
    const d = measureRef(den);
    return {
      data: { name, metricType: "ratio", numerator: n.ref, denominator: d.ref },
      refs: [n, d],
    };
  }

  function metricDraft(metric: DbtMetric): Omit<Draft, "metric"> {
    const tp = metric.type_params ?? {};
    const name = metric.label ?? metric.name;
    const filters = filtersOf(metric.filter);
    const inputs = inputsOf(metric);
    const resolve = (r: InputRef | null, what: string) => {
      if (!r) throw new Unsupported(`${metric.type} metric has no ${what}`);
      return withFilters(resolveInput(...r), filters);
    };
    const window = (w: DbtWindow): Window => {
      const out = toWindow(w);
      if (out.note) {
        warnings.push({
          level: "note",
          resource: `metric ${metric.name}`,
          message: out.note,
        });
      }
      return out;
    };
    switch (metric.type) {
      case "simple":
        return simpleData(resolveSimple(metric.name, []));
      case "ratio":
        return ratioData(
          name,
          resolve(inputs.numerator, "numerator"),
          resolve(inputs.denominator, "denominator"),
        );
      case "cumulative": {
        const ctp = tp.cumulative_type_params;
        if (ctp?.grain_to_date ?? tp.grain_to_date) {
          throw new Unsupported(
            "grain_to_date (period-to-date) has no GrowthBook equivalent",
          );
        }
        const def = resolve(inputs.cumulative, "input metric");
        const out = simpleData({ ...def, label: name });
        const dbtWindow = ctp?.window ?? tp.window;
        if (dbtWindow) {
          const w = window(dbtWindow);
          out.data.windowSettings = {
            type: "lookback",
            windowValue: w.value,
            windowUnit: w.unit,
          };
        }
        return out;
      }
      case "conversion": {
        const c = tp.conversion_type_params;
        if (!c) throw new Unsupported("conversion metric has no parameters");
        if (c.constant_properties?.length) {
          throw new Unsupported(
            "constant_properties cannot be expressed as a funnel",
          );
        }
        if (c.calculation === "conversions") {
          throw new Unsupported(
            "calculation: conversions is not supported (funnels report a rate)",
          );
        }
        const base = resolve(inputs.base, "base");
        const conv = resolve(inputs.conversion, "conversion");
        // Funnels join steps on the experiment's identifier, so the dbt entity
        // must be one; a session- or order-keyed conversion can't be expressed.
        const idType = opts.entities?.[c.entity] ?? c.entity;
        if (opts.idTypes && !opts.idTypes.includes(idType)) {
          throw new Unsupported(
            `conversion entity "${c.entity}" is not a Data Source identifier type; funnels join events on the experiment's identifier`,
          );
        }
        for (const d of [base, conv]) {
          if (!findEntity(d.model, c.entity)) {
            throw new Unsupported(
              `entity "${c.entity}" is not an entity of "${d.model.name}"`,
            );
          }
        }
        const b = measureRef(base);
        const v = measureRef(conv);
        const step = (r: ColumnRef, label: string): FunnelStep => ({
          name: label,
          factTableId: "",
          rowFilters: r.rowFilters ?? [],
          optional: false,
        });
        const s1 = step(b.ref, base.label);
        const s2 = step(v.ref, conv.label);
        if (c.window) {
          const w = window(c.window);
          s2.conversionWindow = { unit: w.unit, value: w.value };
        }
        return {
          data: {
            name,
            metricType: "funnel",
            funnelSettings: { steps: [s1, s2] },
          },
          refs: [
            { ref: s1, usage: b.usage },
            { ref: s2, usage: v.usage },
          ],
        };
      }
      case "derived": {
        const m = /^\s*([A-Za-z_]\w*)\s*\/\s*([A-Za-z_]\w*)\s*$/.exec(
          tp.expr ?? "",
        );
        if (!m) {
          throw new Unsupported(
            'derived metrics are not supported (only "a / b" maps to a ratio)',
          );
        }
        const input = (alias: string) =>
          resolve(
            inputs.derived.find(([i]) => (i.alias ?? i.name) === alias) ?? null,
            `derived input "${alias}"`,
          );
        return ratioData(name, input(m[1]), input(m[2]));
      }
      default:
        throw new Unsupported(`unknown metric type "${metric.type}"`);
    }
  }

  // Selection runs on this before anything is translated, so unselected
  // metrics neither warn nor widen the join sets of the tables that are synced.
  function modelsOf(
    metric: DbtMetric,
    seen = new Set<string>(),
  ): DbtSemanticModel[] {
    if (seen.has(metric.name)) return [];
    seen.add(metric.name);
    const own = metric.type_params?.metric_aggregation_params?.semantic_model;
    const models = [own ? modelsByName.get(own) : undefined];
    const { derived, ...single } = inputsOf(metric);
    for (const [input, kind] of [...Object.values(single), ...derived].filter(
      (r): r is InputRef => r !== null,
    )) {
      const m = kind === "metric" ? metricsByName.get(input.name) : undefined;
      if (m) models.push(...modelsOf(m, seen));
      else models.push(measureIndex.get(input.name)?.model);
    }
    return [
      ...new Set(
        models.filter((m): m is DbtSemanticModel => (m ?? null) !== null),
      ),
    ];
  }

  const drafts: Draft[] = [];
  for (const metric of metrics) {
    if (gbMeta(metric).enabled === false) continue;
    const tags = tagsOf(metric);
    if (matches(opts.exclude, metric.name, tags)) continue;
    const used = modelsOf(metric);
    if (
      opts.select?.length &&
      !matches(opts.select, metric.name, tags) &&
      !used.some((m) => matches(opts.select, m.name, tagsOf(m)))
    ) {
      continue;
    }
    const blocked = used.filter(modelBlocked);
    if (blocked.length) {
      if (blocked.length < used.length) {
        warnings.push({
          level: "skipped",
          resource: `metric ${metric.name}`,
          message: `depends on semantic model "${blocked[0].name}", which is excluded`,
        });
      }
      continue;
    }
    try {
      const out = metricDraft(metric);
      // Fields the sync owns are always sent, so removing them in dbt
      // removes them in GrowthBook (bulk updates keep omitted fields).
      out.data.description = metric.description ?? "";
      out.data.tags = tags;
      if (out.data.metricType !== "funnel" && !out.data.windowSettings) {
        out.data.windowSettings = { type: "none" };
      }
      Object.assign(out.data, omit(gbMeta(metric), ["enabled"]));
      drafts.push({ metric, ...out });
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      warnings.push({
        level: "skipped",
        resource: `metric ${metric.name}`,
        message: e.message,
      });
    }
  }
  return drafts;
}
