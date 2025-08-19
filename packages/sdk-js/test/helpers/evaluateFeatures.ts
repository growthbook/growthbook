import { GrowthBook, Context, RedisStickyBucketService } from "../../src";
/* eslint-disable */
const Redis = require("ioredis-mock");
/* eslint-enable */

export const remoteEvalRedis = new Redis();

export async function evaluateFeatures({
  payload,
  attributes,
  forcedVariations,
  forcedFeatures,
  url,
  ctx,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  attributes: Record<string, any>;
  forcedVariations?: Record<string, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  forcedFeatures?: Map<string, any>;
  url?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx?: any;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evaluatedFeatures: Record<string, any> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const evaluatedExperiments: any[] = [];

  const features = payload?.features;
  const experiments = payload?.experiments;
  const context: Context = { attributes };
  if (features) {
    context.features = features;
  }
  if (experiments) {
    context.experiments = experiments;
  }
  if (forcedVariations) {
    context.forcedVariations = forcedVariations;
  }
  if (url !== undefined) {
    context.url = url;
  }
  // non-standard enable/disable flag for testing purposes
  if (ctx?.enableStickyBucketing) {
    context.stickyBucketService = new RedisStickyBucketService({
      redis: remoteEvalRedis,
    });
  }

  if (features || experiments) {
    const gb = new GrowthBook(context);
    if (forcedFeatures) {
      gb.setForcedFeatures(forcedFeatures);
    }
    if (ctx?.verboseDebugging) {
      gb.debug = true;
    }

    if (context.stickyBucketService) {
      await gb.refreshStickyBuckets();
    }

    const gbFeatures = gb.getFeatures();
    for (const key in gbFeatures) {
      const result = gb.evalFeature(key);

      if (result.on) {
        // reduced feature definition
        evaluatedFeatures[key] = {
          defaultValue: result.value,
        };
        if (result.source === "experiment") {
          evaluatedFeatures[key].rules = [
            {
              force: result.value,
              tracks: [{ experiment: result.experiment, result }],
            },
          ];
        }
      }
    }

    const gbExperiments = gb.getExperiments();
    for (const experiment of gbExperiments) {
      const result = gb.run(experiment);
      if (result.inExperiment) {
        // reduced experiment definition
        const evaluatedExperiment = {
          ...experiment,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          variations: experiment.variations.map((v: any, i: number) =>
            result.variationId === i ? v : {},
          ),
        };
        delete evaluatedExperiment.condition;
        evaluatedExperiments.push(evaluatedExperiment);
      }
    }
  }

  return {
    ...payload,
    features: evaluatedFeatures,
    experiments: evaluatedExperiments,
  };
}
