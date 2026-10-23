import { draftMetrics, TranslateContext } from "./metrics";
import { importPlainModels } from "./plain-models";
import { planTables } from "./tables";
import { DbtManifest, TranslateOptions, TranslateResult } from "./types";
import { values } from "./util";

export function translate(
  manifest: DbtManifest,
  opts: TranslateOptions,
): TranslateResult {
  const models = values(manifest.semantic_models);
  const metrics = values(manifest.metrics);
  const ctx: TranslateContext = {
    opts,
    warnings: [],
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
  const plain = importPlainModels(ctx, values(manifest.nodes));

  const byId = (a: { id: string }, b: { id: string }) =>
    a.id.localeCompare(b.id);
  return {
    payload: {
      defaultManagedBy: "dbt",
      factTables: [...semantic.factTables, ...plain.factTables].sort(byId),
      factMetrics: [...semantic.factMetrics, ...plain.factMetrics].sort(byId),
    },
    warnings: ctx.warnings,
  };
}
