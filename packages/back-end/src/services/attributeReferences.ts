import { z } from "zod";
import { extractConditionAttributeKeys } from "shared/util";
import { getAttributeReferencesValidator } from "shared/validators";
import { getAllFeaturesForGraph } from "back-end/src/models/FeatureModel";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { yieldEventLoop } from "back-end/src/util/yield";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

type AttributeReferences = z.infer<
  typeof getAttributeReferencesValidator.responseSchema
>;
type AttributeRef = AttributeReferences["features"][number];
type AttributeRefExperiment = AttributeReferences["experiments"][number];
type AttributeRefGroup = AttributeReferences["savedGroups"][number];
export type AttributeReferencesMap = Record<string, AttributeReferences>;

// A condition on `user.country` also references `user`
export function getConditionKeyMatches(
  conditionKey: string,
  keySet: Set<string>,
): string[] {
  const matches: string[] = [];
  let key = conditionKey;
  while (true) {
    if (keySet.has(key)) matches.push(key);
    const dot = key.lastIndexOf(".");
    if (dot === -1) return matches;
    key = key.slice(0, dot);
  }
}

// Hash and fallback attributes and ID lists keyed on an attribute count too
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
      if ("fallbackAttribute" in rule && rule.fallbackAttribute)
        addFeature(rule.fallbackAttribute);
      try {
        const parsed = JSON.parse(rule.condition ?? "{}");
        for (const nodeKey of extractConditionAttributeKeys(parsed)) {
          getConditionKeyMatches(nodeKey, keySet).forEach(addFeature);
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
    if (experiment.fallbackAttribute) addExp(experiment.fallbackAttribute);

    const phase = experiment.phases?.slice(-1)?.[0];
    try {
      const parsed = JSON.parse(phase?.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        getConditionKeyMatches(nodeKey, keySet).forEach(addExp);
      }
    } catch {
      // ignore
    }
  }

  for (let i = 0; i < allSavedGroups.length; i++) {
    await yieldEventLoop(i);
    const group = allSavedGroups[i];
    if (group.archived) continue;
    const addGroup = (key: string) => {
      if (!keySet.has(key)) return;
      savedGroupRefs.get(key)!.set(group.id, {
        id: group.id,
        groupName: group.groupName,
        type: group.type,
        projects: group.projects,
      });
    };
    if (group.type === "list") {
      if (group.attributeKey) addGroup(group.attributeKey);
      continue;
    }
    try {
      const parsed = JSON.parse(group.condition ?? "{}");
      for (const nodeKey of extractConditionAttributeKeys(parsed)) {
        getConditionKeyMatches(nodeKey, keySet).forEach(addGroup);
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
