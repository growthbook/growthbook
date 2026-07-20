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
import { BadRequestError } from "back-end/src/util/errors";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

export async function savedGroupUpdated(
  baseContext: ReqContext | ApiReqContext,
) {
  // This is a background job, so create a new context with full read permissions
  const context = getContextForAgendaJobByOrgObject(baseContext.org);
  // Carry the bulk publisher's refresh buffer across the context boundary so a
  // buffered commit's saved-group side effects don't escape it.
  context.sdkPayloadRefreshBuffer = baseContext.sdkPayloadRefreshBuffer;

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

// Block deleting a still-referenced saved group. A dangling group id silently
// flips live targeting — `$inGroup` on a missing group never matches, and
// `$notInGroup` always matches — so this is a reference-integrity guard, not an
// approval gate: it applies regardless of archived state or REST bypass. Scans
// org-wide (a reference in an unreadable project still breaks). Matches the copy
// style of assertConstantArchivable.
export async function assertSavedGroupDeletable(
  context: ReqContext | ApiReqContext,
  savedGroupId: string,
): Promise<void> {
  const scanContext = getContextForAgendaJobByOrgObject(context.org);
  const refs = await loadSavedGroupReferences(scanContext, savedGroupId);
  if (!refs || totalSavedGroupReferences(refs) === 0) return;
  const parts: string[] = [];
  if (refs.features.length) parts.push(`${refs.features.length} feature(s)`);
  if (refs.experiments.length) {
    parts.push(`${refs.experiments.length} experiment(s)`);
  }
  if (refs.savedGroups.length) {
    parts.push(`${refs.savedGroups.length} other Saved Group(s)`);
  }
  throw new BadRequestError(
    `Cannot delete Saved Group: it is still referenced by ${parts.join(
      ", ",
    )}. Remove these references first.`,
  );
}
