import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  getAllExperiments,
  getPayloadKeysForAllEnvs,
} from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

export async function savedGroupUpdated(
  baseContext: ReqContext | ApiReqContext,
) {
  // This is a background job, so create a new context with full read permissions
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  // Saved groups can be nested recursively and may be referenced cross-project
  // To be safe, refresh all cache entries across all environments/projects
  // TODO: Optimize this later if performance becomes an issue
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event: "updated",
      model: "savedgroup",
    },
  });
}

export type SavedGroupReferences = {
  features: { id: string; name: string; project?: string }[];
  experiments: {
    id: string;
    name: string;
    project?: string;
    projects?: string[];
  }[];
  savedGroups: { id: string; groupName: string; projects?: string[] }[];
};

/**
 * Returns features, experiments, and saved groups that reference the given
 * saved group. Includes one level of saved-group chaining (saved groups whose
 * condition string directly contains the target's ID, plus any
 * features/experiments that reference those).
 *
 * Returns null if the target saved group does not exist.
 */
export async function loadSavedGroupReferences(
  context: ReqContext | ApiReqContext,
  savedGroupId: string,
): Promise<SavedGroupReferences | null> {
  const allSavedGroups = await context.models.savedGroups.getAll();
  const targetGroup = allSavedGroups.find((sg) => sg.id === savedGroupId);
  if (!targetGroup) return null;

  const savedGroupsReferencingTarget = allSavedGroups.filter(
    (sg) => sg.id !== savedGroupId && sg.condition?.includes(savedGroupId),
  );

  const savedGroupsToCheck = [targetGroup, ...savedGroupsReferencingTarget];

  const environments = context.org.settings?.environments || [];

  const [allFeatures, allExperiments] = await Promise.all([
    getAllFeatures(context, {}),
    getAllExperiments(context, {}),
  ]);

  const featureRefMap = featuresReferencingSavedGroups({
    savedGroups: savedGroupsToCheck,
    features: allFeatures,
    environments,
  });

  const experimentRefMap = experimentsReferencingSavedGroups({
    savedGroups: savedGroupsToCheck,
    experiments: allExperiments,
  });

  const featuresSet = new Map<
    string,
    { id: string; name: string; project?: string }
  >();
  const experimentsSet = new Map<
    string,
    { id: string; name: string; project?: string; projects?: string[] }
  >();

  for (const sg of savedGroupsToCheck) {
    for (const f of featureRefMap[sg.id] ?? []) {
      featuresSet.set(f.id, { id: f.id, name: f.id, project: f.project });
    }
    for (const e of experimentRefMap[sg.id] ?? []) {
      experimentsSet.set(e.id, {
        id: e.id,
        name: e.name,
        project: (e as { project?: string }).project,
        projects: (e as { projects?: string[] }).projects,
      });
    }
  }

  return {
    features: Array.from(featuresSet.values()),
    experiments: Array.from(experimentsSet.values()),
    savedGroups: savedGroupsReferencingTarget.map((sg) => ({
      id: sg.id,
      groupName: sg.groupName,
      projects: sg.projects,
    })),
  };
}

export function totalSavedGroupReferences(refs: SavedGroupReferences): number {
  return (
    refs.features.length + refs.experiments.length + refs.savedGroups.length
  );
}
