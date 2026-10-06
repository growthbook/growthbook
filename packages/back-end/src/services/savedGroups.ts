import {
  experimentsReferencingSavedGroups,
  featuresReferencingSavedGroups,
  targetingReferencesSavedGroup,
  contextualBanditTargetingServes,
} from "shared/util";
import { forEachSavedGroupIdInCondition } from "shared/sdk-versioning";
import type { FeatureInterface } from "shared/types/feature";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  GroupMap,
  SavedGroupWithoutValues,
} from "shared/types/saved-group";
import type { ContextualBanditInterface } from "shared/validators";
import type { SDKPayloadKey } from "back-end/types/sdk-payload";
import { ReqContext } from "back-end/types/request";
import {
  getAllExperiments,
  getAllPayloadExperiments,
  getPayloadKeys,
  getPayloadKeysForAllEnvs,
} from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import { getAllFeaturesForGraph } from "back-end/src/models/FeatureModel";
import { BadRequestError } from "back-end/src/util/errors";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import {
  getSavedGroupIdsForFeatureDefinitions,
  getSavedGroupIdsInTargeting,
  loadSavedGroupsWithNested,
  TargetingSource,
} from "back-end/src/util/featureDefinitionReferences.util";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

/**
 * What a change to one saved group can alter in SDK payloads: the features and
 * experiments whose targeting names it, directly or through condition groups
 * that name it. `holdoutAffected` is set when a holdout's targeting names it.
 */
export function findSavedGroupDependents({
  groupId,
  savedGroups,
  features,
  experiments,
  holdoutExperiments,
  bandits,
}: {
  groupId: string;
  savedGroups: Pick<SavedGroupWithoutValues, "id" | "condition">[];
  features: FeatureInterface[];
  experiments: Iterable<ExperimentInterface>;
  holdoutExperiments: ExperimentInterface[];
  bandits: ContextualBanditInterface[];
}) {
  // The group plus every condition group that reaches it.
  const reaching = new Set([groupId]);
  const namedBy = new Map<string, string[]>();
  for (const group of savedGroups) {
    if (!group.condition) continue;
    try {
      forEachSavedGroupIdInCondition(JSON.parse(group.condition), (id) => {
        namedBy.set(id, [...(namedBy.get(id) ?? []), group.id]);
      });
    } catch {
      // Malformed conditions name nothing the payload can resolve.
    }
  }
  const queue = [groupId];
  while (queue.length) {
    for (const parent of namedBy.get(queue.shift() as string) ?? []) {
      if (reaching.has(parent)) continue;
      reaching.add(parent);
      queue.push(parent);
    }
  }
  const names = (
    sources: Parameters<typeof getSavedGroupIdsForFeatureDefinitions>[0],
  ) =>
    getSavedGroupIdsForFeatureDefinitions(sources).some((id) =>
      reaching.has(id),
    );

  const banditIds = new Set(
    bandits
      .filter((bandit) => names({ features: [], bandits: [bandit] }))
      .map((bandit) => bandit.id),
  );
  return {
    features: features.filter(
      (feature) =>
        names({ features: [feature] }) ||
        (feature.rules ?? []).some(
          (rule) =>
            rule?.type === "contextual-bandit-ref" &&
            banditIds.has(rule.contextualBanditId),
        ),
    ),
    experiments: [...experiments].filter((experiment) =>
      names({ features: [], experiments: [experiment] }),
    ),
    holdoutAffected: holdoutExperiments.some((experiment) =>
      names({ features: [], experiments: [experiment] }),
    ),
  };
}

// The payloads a change to `groupId` can alter, or null when only an
// org-wide refresh is known to be safe.
export async function getSavedGroupPayloadKeys(
  context: ReqContext,
  groupId: string,
): Promise<SDKPayloadKey[] | null> {
  const [savedGroups, features, experimentMap, holdoutExperiments, bandits] =
    await Promise.all([
      context.models.savedGroups.getAllWithoutValues(),
      getAllFeaturesForGraph(context, {}),
      getAllPayloadExperiments(context),
      getAllExperiments(context, { type: "holdout" }),
      context.models.contextualBandits.getAll(),
    ]);
  const dependents = findSavedGroupDependents({
    groupId,
    savedGroups,
    features,
    experiments: experimentMap.values(),
    holdoutExperiments,
    bandits,
  });
  if (dependents.holdoutAffected) return null;

  const allProjectIds = await context.getAllProjectIds();
  const featuresById = new Map(features.map((f) => [f.id, f]));
  return [
    ...getAffectedSDKPayloadKeys(
      dependents.features,
      getEnvironmentIdsFromOrg(context.org),
      undefined,
      allProjectIds,
    ),
    ...dependents.experiments.flatMap((experiment) =>
      getPayloadKeys(
        context,
        experiment,
        (experiment.linkedFeatures ?? [])
          .map((id) => featuresById.get(id))
          .filter((f): f is FeatureInterface => !!f),
        allProjectIds,
      ),
    ),
  ];
}

// Reference checks read ids and conditions, never the ID lists, and only for
// the groups the targeting names and the groups those reach.
export async function getSavedGroupsForValidation(
  context: ReqContext | ApiReqContext,
  targets: TargetingSource[],
): Promise<GroupMap> {
  const groups = await loadSavedGroupsWithNested(
    getSavedGroupIdsInTargeting(targets),
    (ids) => context.models.savedGroups.getAllWithoutValues(ids),
  );
  return new Map(groups.map((group) => [group.id, group]));
}

export async function savedGroupUpdated(
  baseContext: ReqContext | ApiReqContext,
  groupId?: string,
  { projectsChanged = false }: { projectsChanged?: boolean } = {},
) {
  // This is a background job, so create a new context with full read permissions
  const context = getContextForAgendaJobByOrgObject(baseContext.org);
  // Carry the bulk publisher's refresh buffer across the context boundary so a
  // buffered commit's saved-group side effects don't escape it.
  context.sdkPayloadRefreshBuffer = baseContext.sdkPayloadRefreshBuffer;
  const auditContext = { event: "updated", model: "savedgroup" } as const;

  // A project change, a holdout reference or a failed scan refreshes every
  // payload.
  if (groupId && !projectsChanged) {
    let payloadKeys: SDKPayloadKey[] | null = null;
    try {
      payloadKeys = await getSavedGroupPayloadKeys(context, groupId);
    } catch (e) {
      context.logger.warn(e, "Scoping a saved group refresh failed");
    }
    if (payloadKeys) {
      if (payloadKeys.length) {
        queueSDKPayloadRefresh({ context, payloadKeys, auditContext });
      }
      return;
    }
  }

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext,
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
  contextualBandits: { id: string; name: string; project?: string }[];
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
  const allSavedGroups = await context.models.savedGroups.getAllWithoutValues();
  const targetGroup = allSavedGroups.find((sg) => sg.id === savedGroupId);
  if (!targetGroup) return null;

  const savedGroupsReferencingTarget = allSavedGroups.filter(
    (sg) => sg.id !== savedGroupId && sg.condition?.includes(savedGroupId),
  );

  const savedGroupsToCheck = [targetGroup, ...savedGroupsReferencingTarget];

  const environments = context.org.settings?.environments || [];

  // The lean loader: the reference scan reads only rules/env settings, and
  // this loader honors the bulk publisher's feature scan overlay so the scan
  // can evaluate a release's proposed end-state.
  const [allFeatures, allExperiments, holdoutExperiments, allBandits] =
    await Promise.all([
      getAllFeaturesForGraph(context, {}),
      getAllExperiments(context, {}),
      // Left out of the default experiment query; a holdout's phase targeting
      // is served on every feature it holds out.
      getAllExperiments(context, { type: "holdout" }),
      context.models.contextualBandits.getAll(),
    ]);

  const featureRefMap = featuresReferencingSavedGroups({
    savedGroups: savedGroupsToCheck,
    features: allFeatures,
    environments,
  });

  const experimentRefMap = experimentsReferencingSavedGroups({
    savedGroups: savedGroupsToCheck,
    experiments: [...allExperiments, ...holdoutExperiments],
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

  const groupIds = savedGroupsToCheck.map((sg) => sg.id);
  const contextualBandits = allBandits
    .filter(
      (cb) =>
        contextualBanditTargetingServes(cb) &&
        groupIds.some((id) => targetingReferencesSavedGroup(cb, id)),
    )
    .map((cb) => ({ id: cb.id, name: cb.name, project: cb.project }));

  return {
    features: Array.from(featuresSet.values()),
    experiments: Array.from(experimentsSet.values()),
    contextualBandits,
    savedGroups: savedGroupsReferencingTarget.map((sg) => ({
      id: sg.id,
      groupName: sg.groupName,
      projects: sg.projects,
    })),
  };
}

export function totalSavedGroupReferences(refs: SavedGroupReferences): number {
  return (
    refs.features.length +
    refs.experiments.length +
    refs.contextualBandits.length +
    refs.savedGroups.length
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
  if (refs.contextualBandits.length) {
    parts.push(`${refs.contextualBandits.length} contextual bandit(s)`);
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
