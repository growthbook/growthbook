import type { FeatureInterface } from "shared/types/feature";
import { stemRuleId } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getExperimentsByIds } from "back-end/src/models/ExperimentModel";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import type { RolloutLookups } from "back-end/src/util/rollouts";

// Everything `getActiveRollouts` needs beyond the features themselves: the
// status of each linked experiment, the ramp schedule (if any) behind each
// rule, and the prerequisite graph.
export async function loadRolloutLookups(
  context: ReqContext | ApiReqContext,
  features: FeatureInterface[],
): Promise<RolloutLookups> {
  const experimentIds = new Set<string>();
  let hasPrerequisites = false;
  for (const feature of features) {
    if (feature.prerequisites?.length) hasPrerequisites = true;
    for (const rule of feature.rules ?? []) {
      if (rule?.type === "experiment-ref") experimentIds.add(rule.experimentId);
    }
  }

  const [experiments, schedules, graph] = await Promise.all([
    getExperimentsByIds(context, [...experimentIds]).then(
      (list) => new Map(list.map((e) => [e.id, e])),
    ),
    context.models.rampSchedules.getAllByFeatureIds(features.map((f) => f.id)),
    hasPrerequisites
      ? getAllFeaturesWithoutEditorFields(context, { includeArchived: true })
      : null,
  ]);

  const rampSchedules: RolloutLookups["rampSchedules"] = new Map();
  for (const schedule of schedules) {
    for (const target of schedule.targets) {
      if (target.ruleId) rampSchedules.set(stemRuleId(target.ruleId), schedule);
    }
  }

  return {
    experiments,
    rampSchedules,
    ...(graph ? { featuresMap: new Map(graph.map((f) => [f.id, f])) } : {}),
  };
}
