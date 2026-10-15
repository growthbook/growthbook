import { extractConditionAttributeKeys } from "shared/util";
import { getAllFeaturesForGraph } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { yieldEventLoop } from "back-end/src/util/yield";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

type AttributeRef = { id: string; name: string; project?: string };
type AttributeRefExperiment = {
  id: string;
  name: string;
  project?: string;
  projects?: string[];
};
type AttributeRefGroup = { id: string; groupName: string; projects?: string[] };
export type AttributeReferencesMap = Record<
  string,
  {
    features: AttributeRef[];
    experiments: AttributeRefExperiment[];
    savedGroups: AttributeRefGroup[];
  }
>;

/**
 * Features, experiments, and condition groups that reference each attribute key.
 * Walks rule/phase condition JSON and checks hashAttribute on rules and experiments.
 */
export async function getAttributeReferences(
  context: ReqContext | ApiReqContext,
  attributeKeys: string[],
): Promise<AttributeReferencesMap> {
  if (!attributeKeys.length) return {};

  const keySet = new Set(attributeKeys);

  // Only conditions are read, so values and ID lists stay in the database
  const [allFeatures, allExperiments, allSavedGroups] = await Promise.all([
    getAllFeaturesForGraph(context),
    getAllExperiments(context, {}),
    context.models.savedGroups.getAllWithoutValues(),
  ]);

  // { attributeKey -> { featureId -> { id, name, project } } }
  const featureRefs = new Map<string, Map<string, AttributeRef>>();
  const experimentRefs = new Map<string, Map<string, AttributeRefExperiment>>();
  const savedGroupRefs = new Map<string, Map<string, AttributeRefGroup>>();

  for (const key of attributeKeys) {
    featureRefs.set(key, new Map());
    experimentRefs.set(key, new Map());
    savedGroupRefs.set(key, new Map());
  }

  for (let i = 0; i < allFeatures.length; i++) {
    await yieldEventLoop(i);
    const feature = allFeatures[i];
    const addFeature = (key: string) => {
      if (!keySet.has(key)) return;
      featureRefs.get(key)!.set(feature.id, {
        id: feature.id,
        name: feature.id,
        project: feature.project,
      });
    };
    for (const rule of feature.rules ?? []) {
      if ("hashAttribute" in rule) addFeature(rule.hashAttribute);
      try {
        const parsed = JSON.parse(rule.condition ?? "{}");
        for (const nodeKey of extractConditionAttributeKeys(parsed)) {
          addFeature(nodeKey);
        }
      } catch {
        // ignore unparseable conditions
      }
    }
  }

  for (let i = 0; i < allExperiments.length; i++) {
    await yieldEventLoop(i);
    const experiment = allExperiments[i];
    const addExp = (key: string) => {
      if (!keySet.has(key)) return;
      experimentRefs.get(key)!.set(experiment.id, {
        id: experiment.id,
        name: experiment.name,
        project: (experiment as { project?: string }).project,
        projects: (experiment as { projects?: string[] }).projects,
      });
    };

    addExp(experiment.hashAttribute);

    const phase = experiment.phases?.slice(-1)?.[0];
    try {
      const parsed = JSON.parse(phase?.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        addExp(nodeKey);
      }
    } catch {
      // ignore
    }
  }

  for (let i = 0; i < allSavedGroups.length; i++) {
    await yieldEventLoop(i);
    const group = allSavedGroups[i];
    if (group.type !== "condition" || group.archived) continue;
    try {
      const parsed = JSON.parse(group.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        if (keySet.has(nodeKey)) {
          savedGroupRefs.get(nodeKey)!.set(group.id, {
            id: group.id,
            groupName: group.groupName,
            projects: group.projects,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const references: AttributeReferencesMap = {};
  for (const key of attributeKeys) {
    references[key] = {
      features: Array.from(featureRefs.get(key)!.values()),
      experiments: Array.from(experimentRefs.get(key)!.values()),
      savedGroups: Array.from(savedGroupRefs.get(key)!.values()),
    };
  }
  return references;
}
