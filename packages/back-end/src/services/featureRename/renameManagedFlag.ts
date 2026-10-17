import {
  featureKeyFormatError,
  getApplicableEnvIds,
  isManagedByExperiment,
  type ManagedFlagRenameBlocker,
} from "shared/util";
import {
  TERMINAL_RAMP_SCHEDULE_STATUSES,
  type ExperimentInterface,
  type FeatureInterface,
} from "shared/validators";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ReqContext } from "back-end/types/request";
import {
  claimFeatureRename,
  featureIdExists,
  finishFeatureRename,
  getFeature,
  getFeaturesByIdsUnfiltered,
  logFeatureUpdatedEvent,
  markFeatureRenameCleaned,
} from "back-end/src/models/FeatureModel";
import {
  captureEventBuffer,
  emitOrDeferBulkPublishEvent,
  entityKey,
} from "back-end/src/events/bulkPublishCorrelation";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  getAffectedSDKPayloadKeys,
  getEnabledEnvironments,
} from "back-end/src/util/features";
import {
  getEnvironmentIdsFromOrg,
  getEnvironments,
} from "back-end/src/util/organization.util";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  createVercelExperimentationItemFromFeature,
  deleteVercelExperimentationItemFromFeature,
} from "back-end/src/services/vercel-native-integration.service";
import { getCollection } from "back-end/src/util/mongo.util";
import {
  BadRequestError,
  FeatureKeyTakenError,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  FEATURE_ID_REFERENCES,
  type RenameRef,
} from "back-end/src/services/featureRename/featureIdReferences";

/** Why the experiment's managed flag can't take `to`, or null when it can. */
export async function managedFlagRenameBlocker(
  context: ReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
  to: string,
): Promise<ManagedFlagRenameBlocker | null> {
  const state = (message: string) => ({ reason: "state" as const, message });
  if (!isManagedByExperiment(feature, experiment.id)) {
    return state(
      "Only a Feature Flag this experiment manages can be renamed here.",
    );
  }
  if (experiment.status !== "draft" || experiment.archived) {
    return state(
      "A managed Feature Flag can only be renamed while its experiment is a draft. Set its status back to Draft first.",
    );
  }
  const formatError = featureKeyFormatError(
    to,
    context.org.settings?.featureRegexValidator,
  );
  if (formatError) return { reason: "format", message: formatError };
  if (to !== feature.id && (await featureIdExists(context, to))) {
    return { reason: "taken", message: `Feature Flag "${to}" already exists.` };
  }
  const [armedRevisions, activeRamps] = await Promise.all([
    getCollection("featurerevisions").countDocuments({
      organization: context.org.id,
      featureId: feature.id,
      status: { $nin: ["published", "discarded"] },
      scheduledPublishAt: { $type: "date" },
    }),
    getCollection("rampschedules").countDocuments({
      organization: context.org.id,
      status: { $nin: TERMINAL_RAMP_SCHEDULE_STATUSES },
      $or: [
        { entityType: "feature", entityId: feature.id },
        {
          targets: {
            $elemMatch: { entityType: "feature", entityId: feature.id },
          },
        },
      ],
    }),
  ]);
  if (armedRevisions) {
    return state(
      "This Feature Flag has a scheduled publish. Cancel it before renaming the Feature Flag.",
    );
  }
  if (activeRamps) {
    return state(
      "This Feature Flag has an active ramp schedule. End it before renaming the Feature Flag.",
    );
  }
  return null;
}

/**
 * Whether the caller may rename the experiment's managed flag: an edit of the
 * experiment that takes the old key out of service and creates the new one
 * wherever the flag is enabled.
 */
export function canRenameManagedFlag(
  context: ReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
): boolean {
  const envs = Array.from(
    getEnabledEnvironments(
      feature,
      getApplicableEnvIds(getEnvironments(context.org), feature),
    ),
  );
  return (
    context.permissions.canUpdateExperiment(experiment, {}) &&
    context.permissions.canDeleteFeature(feature, envs) &&
    context.permissions.canCreateFeature(feature, envs)
  );
}

/** Throws what `managedFlagRenameBlocker` finds, or a missing permission. */
export async function assertManagedFlagRenamable(
  context: ReqContext,
  experiment: ExperimentInterface,
  feature: FeatureInterface,
  to: string,
): Promise<void> {
  if (!canRenameManagedFlag(context, experiment, feature)) {
    context.permissions.throwPermissionError();
  }
  const blocker = await managedFlagRenameBlocker(
    context,
    experiment,
    feature,
    to,
  );
  if (blocker?.reason === "taken") {
    throw new FeatureKeyTakenError(blocker.message, {
      featureKey: to,
      suggestedTrackingKey: null,
      suggestedFeatureKey: null,
    });
  }
  if (blocker) throw new BadRequestError(blocker.message);
}

/**
 * Gives an experiment's managed flag a new id and moves every stored
 * reference with it (see FEATURE_ID_REFERENCES). The old id stays on the flag
 * in `previousIds` so history and code references still find it.
 */
export async function renameManagedFlag({
  context,
  experiment,
  feature,
  to,
  audit,
}: {
  context: ReqContext;
  experiment: ExperimentInterface;
  feature: FeatureInterface;
  to: string;
  audit: (data: AuditInterfaceInput) => Promise<void>;
}): Promise<FeatureInterface> {
  await resumeFeatureRename(context, feature);
  if (to === feature.id) return feature;

  await assertManagedFlagRenamable(context, experiment, feature, to);

  const from = feature.id;
  const org = context.org.id;
  // Linked to both ids until the cascade drops `from`, so the experiment
  // finds its flag at every step, including after an interrupted rename.
  const experiments = getCollection("experiments");
  await experiments.updateOne(
    { organization: org, id: experiment.id },
    { $addToSet: { linkedFeatures: to } },
  );
  let renaming: NonNullable<FeatureInterface["renaming"]>;
  try {
    renaming = await claimFeatureRename(context, feature, to);
  } catch (e) {
    await experiments.updateOne(
      { organization: org, id: experiment.id },
      { $pull: { linkedFeatures: to } },
    );
    throw e;
  }
  const moved = await continueFeatureRename(context, renaming);

  const renamed = await getFeature(context, to);
  if (!renamed) throw new Error(`Feature Flag "${to}" not found after rename`);
  await afterFeatureRename(context, feature, renamed, moved);
  await audit({
    event: "feature.update",
    entity: { object: "feature", id: to },
    details: auditDetailsUpdate(feature, renamed, { renamedFrom: from }),
  });
  return renamed;
}

/** Completes a rename that stopped partway; every step is repeatable. */
export async function resumeFeatureRename(
  context: ReqContext,
  feature: FeatureInterface,
): Promise<void> {
  if (!feature.renaming) return;
  const moved = await continueFeatureRename(context, feature.renaming);
  const renamed = await getFeature(context, feature.renaming.to);
  if (renamed) {
    const before = { ...feature, id: feature.renaming.from };
    await afterFeatureRename(context, before, renamed, moved);
  }
}

/**
 * Everything after the claim. Returns the other flags whose references moved,
 * as they were, since their payloads change too.
 */
async function continueFeatureRename(
  context: ReqContext,
  renaming: NonNullable<FeatureInterface["renaming"]>,
): Promise<FeatureInterface[]> {
  const { from, to, claimedAt } = renaming;
  if (!renaming.cleaned) {
    // Left by a deleted flag that once held `to`. Everything the cascade
    // moves is stamped at or after the claim, so a late or repeated clean
    // can't reach this flag's own revisions.
    const leftover = {
      organization: context.org.id,
      featureId: to,
      $or: [
        { dateUpdated: { $lt: claimedAt } },
        { dateUpdated: { $exists: false } },
      ],
    };
    await Promise.all([
      getCollection("featurerevisions").deleteMany(leftover),
      getCollection("featurerevisionlog").deleteMany(leftover),
    ]);
    await markFeatureRenameCleaned(context, { from, to });
  }
  const moved = await moveFeatureIdReferences(context, renaming);
  await finishFeatureRename(context, { from, to });
  return moved;
}

const MAX_REWRITE_ATTEMPTS = 5;

/**
 * Rewrites every stored reference. Each write is conditioned on what it read,
 * so a concurrent edit is re-read rather than overwritten, and it advances
 * `dateUpdated` so a concurrent writer holding the old value fails.
 */
async function moveFeatureIdReferences(
  context: ReqContext,
  { from, to, claimedAt }: { from: string; to: string; claimedAt: Date },
): Promise<FeatureInterface[]> {
  const ref: RenameRef = {
    from,
    to,
    environments: getEnvironmentIdsFromOrg(context.org),
  };
  const movedFeatures: FeatureInterface[] = [];
  for (const reference of FEATURE_ID_REFERENCES) {
    const collection = getCollection(reference.collection);
    const docs = await collection
      .find({ organization: context.org.id, ...reference.filter(ref) })
      .toArray();
    // The other flags as they were, for their update events.
    const featuresBefore =
      reference.collection === "features"
        ? new Map(
            (
              await getFeaturesByIdsUnfiltered(
                context,
                docs.map((d) => d.id).filter((id) => id !== to),
              )
            ).map((f) => [f.id, f]),
          )
        : null;
    for (let doc of docs) {
      for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt++) {
        const set = reference.rewrite(doc, ref);
        if (!set) break;
        const filter: Record<string, unknown> = { _id: doc._id };
        for (const field of Object.keys(set)) {
          if (comparableAsRead(doc[field])) filter[field] = doc[field];
        }
        const previous =
          doc.dateUpdated instanceof Date ? doc.dateUpdated.getTime() : 0;
        if (previous) filter.dateUpdated = doc.dateUpdated;
        else filter.dateUpdated = { $exists: false };
        set.dateUpdated = new Date(
          Math.max(Date.now(), previous + 1, claimedAt.getTime()),
        );
        const result = await collection.updateOne(filter, { $set: set });
        if (result.matchedCount) {
          const before = featuresBefore?.get(doc.id);
          if (before) movedFeatures.push(before);
          break;
        }
        if (attempt === MAX_REWRITE_ATTEMPTS - 1) {
          throw new Error(
            `Could not move a reference to Feature Flag "${from}" in ${reference.collection}; it kept changing.`,
          );
        }
        const fresh = await collection.findOne({ _id: doc._id });
        if (!fresh) break;
        doc = fresh;
      }
    }
  }
  return movedFeatures;
}

// Whole-field equality needs the stored key order, which JavaScript loses for
// integer-like keys (a record keyed by an all-digit flag id), and doubles the
// command size; `dateUpdated` guards those fields instead.
const MAX_COMPARED_FIELD_BYTES = 1_000_000;
function comparableAsRead(value: unknown): boolean {
  let integerKey = false;
  const json = JSON.stringify(value, function (this: unknown, key, v) {
    // Array indices arrive here too; only object keys are reordered.
    if (!Array.isArray(this) && /^(0|[1-9]\d*)$/.test(key)) integerKey = true;
    return v;
  });
  return !integerKey && (json?.length ?? 0) <= MAX_COMPARED_FIELD_BYTES;
}

// Unfiltered: a dependent the caller can't read changed all the same.
async function afterFeatureRename(
  context: ReqContext,
  before: FeatureInterface,
  after: FeatureInterface,
  movedBefore: FeatureInterface[],
) {
  // Before the first await, as onFeatureUpdate does.
  const buffer = captureEventBuffer(context);
  const [allProjectIds, dependents] = await Promise.all([
    context.getAllProjectIds(),
    getFeaturesByIdsUnfiltered(
      context,
      movedBefore.map((f) => f.id),
    ),
  ]);
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      [before, after, ...dependents],
      getEnvironmentIdsFromOrg(context.org),
      undefined,
      allProjectIds,
    ),
    auditContext: { event: "updated", model: "feature", id: after.id },
  });

  // Event webhooks learn the new key, and each prerequisite that moved with it.
  const updates: [FeatureInterface, FeatureInterface][] = [
    [before, after],
    ...dependents.flatMap((current): [FeatureInterface, FeatureInterface][] => {
      const previous = movedBefore.find((f) => f.id === current.id);
      return previous ? [[previous, current]] : [];
    }),
  ];
  // A dependent may be in a project the caller can't read; its experiments and
  // Saved Groups still belong in its payload.
  const scanContext =
    context.scanContextOverride ??
    getContextForAgendaJobByOrgObject(context.org);
  for (const [previous, current] of updates) {
    await emitOrDeferBulkPublishEvent(
      () => logFeatureUpdatedEvent(context, previous, current, scanContext),
      entityKey("feature", current.id),
      buffer,
    );
  }

  if (!context.org.isVercelIntegration) return;
  // Vercel keys its items by flag id, so the item moves too.
  try {
    await deleteVercelExperimentationItemFromFeature({
      feature: before,
      organization: context.org,
    });
    await createVercelExperimentationItemFromFeature({
      feature: after,
      organization: context.org,
    });
  } catch (e) {
    logger.error(e, "Could not move the Vercel item for a renamed flag");
  }
}
