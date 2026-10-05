import type { FeatureInterface } from "shared/types/feature";
import type { ExperimentInterface } from "shared/types/experiment";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getFeaturesWithPrerequisitesOn } from "back-end/src/models/FeatureModel";
import { getAllExperimentsForStaleGraph } from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgObject } from "./organizations";

/**
 * The part of the feature graph a stale verdict for `featureIds` reads: those
 * features, every feature that depends on them (transitively), the
 * experiments their experiment-ref rules point at, and the experiments that
 * depend on any of them, one query per dependency level.
 *
 * Loaded with full read access: whether a flag still has live dependents does
 * not depend on who is asking.
 */
export async function loadStaleGraph(
  context: ReqContext | ApiReqContext,
  featureIds: string[],
): Promise<{
  features: FeatureInterface[];
  experiments: ExperimentInterface[];
}> {
  const scan = getContextForAgendaJobByOrgObject(context.org);
  const features = new Map<string, FeatureInterface>();
  let frontier = [...new Set(featureIds)];
  while (frontier.length) {
    const loaded = await getFeaturesWithPrerequisitesOn(scan, frontier);
    frontier = [];
    for (const feature of loaded) {
      if (features.has(feature.id)) continue;
      features.set(feature.id, feature);
      frontier.push(feature.id);
    }
  }

  const graphIds = [...features.keys()];
  const referencedExperimentIds = [
    ...new Set(
      [...features.values()].flatMap((feature) =>
        (feature.rules ?? []).flatMap((rule) =>
          rule?.type === "experiment-ref" ? [rule.experimentId] : [],
        ),
      ),
    ),
  ];
  const [dependentExperiments, referencedExperiments] = await Promise.all([
    getAllExperimentsForStaleGraph(scan, { prerequisiteIds: graphIds }),
    getAllExperimentsForStaleGraph(scan, { ids: referencedExperimentIds }),
  ]);
  const experiments = new Map(
    [...dependentExperiments, ...referencedExperiments].map((e) => [e.id, e]),
  );
  return {
    features: [...features.values()],
    experiments: [...experiments.values()],
  };
}
