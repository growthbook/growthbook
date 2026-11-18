import { draftMetrics, TranslateContext } from "./metrics";
import { importPlainModels } from "./plain-models";
import { metricKey } from "./prune";
import { planTables } from "./tables";
import {
  DbtManifest,
  DbtSemanticModel,
  TranslateOptions,
  TranslateResult,
  TranslateWarning,
} from "./types";
import { gbMeta, isRecord, matches, tagsOf, values } from "./util";

// A mistyped mapping would silently skip every table it was meant to cover.
function checkEntities(models: DbtSemanticModel[], opts: TranslateOptions) {
  const known = [
    ...new Set(models.flatMap((m) => (m.entities ?? []).map((e) => e.name))),
  ].sort();
  for (const [from, to] of Object.entries(opts.entities ?? {})) {
    if (!known.includes(from)) {
      throw new Error(
        `Entity mapping "${from}=${to}": no semantic model has an entity named "${from}" (entities: ${known.join(", ") || "none"})`,
      );
    }
    if (opts.idTypes && !opts.idTypes.includes(to)) {
      throw new Error(
        `Entity mapping "${from}=${to}": "${to}" is not an identifier type on this Data Source (identifier types: ${opts.idTypes.join(", ") || "none"})`,
      );
    }
  }
}

function unmatchedSelectors(
  manifest: DbtManifest,
  opts: TranslateOptions,
): TranslateWarning[] {
  const models = values(manifest.nodes).filter(
    (n) => n.resource_type === "model",
  );
  const named = [
    ...values(manifest.semantic_models),
    ...values(manifest.metrics),
    ...models,
  ].map((x) => ({ name: x.name, tags: tagsOf(x) }));
  for (const node of models) {
    const entries = gbMeta(node).metrics;
    for (const m of Array.isArray(entries) ? entries : []) {
      if (isRecord(m) && typeof m.id === "string") {
        named.push({ name: m.id, tags: [] });
      }
    }
  }
  const flags = [
    ["--select", opts.select],
    ["--exclude", opts.exclude],
  ] as const;
  return flags.flatMap(([flag, patterns]) =>
    (patterns ?? [])
      .filter((p) => !named.some((n) => matches([p], n.name, n.tags)))
      .map((p) => ({
        level: "note" as const,
        resource: flag,
        message: `"${p}" matched no metric or model`,
      })),
  );
}

export function translate(
  manifest: DbtManifest,
  opts: TranslateOptions,
): TranslateResult {
  const models = values(manifest.semantic_models);
  const metrics = values(manifest.metrics);
  checkEntities(models, opts);
  const ctx: TranslateContext = {
    opts,
    warnings: unmatchedSelectors(manifest, opts),
    models,
    modelsByName: new Map(models.map((m) => [m.name, m])),
    metrics,
    metricsByName: new Map(metrics.map((m) => [m.name, m])),
    measureIndex: new Map(
      models.flatMap((model) =>
        (model.measures ?? []).map((measure) => [
          measure.name,
          { model, measure },
        ]),
      ),
    ),
  };

  const semantic = planTables(ctx, draftMetrics(ctx));
  const plain = importPlainModels(
    ctx,
    values(manifest.nodes),
    new Set(semantic.factTables.map((t) => t.id)),
  );

  // The API stores `x` and `fact__x` under one id, so the later one would overwrite the first.
  const seen = new Set<string>();
  const factMetrics = [...semantic.factMetrics, ...plain.factMetrics].filter(
    (m) => {
      const key = metricKey(m.id);
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      ctx.warnings.push({
        level: "skipped",
        resource: `metric ${m.id}`,
        message: `another metric already has the id "${key}"`,
      });
      return false;
    },
  );

  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  return {
    payload: {
      defaultManagedBy: "dbt",
      factTables: [...semantic.factTables, ...plain.factTables].sort(byId),
      factMetrics: factMetrics.sort(byId),
    },
    warnings: ctx.warnings,
  };
}
