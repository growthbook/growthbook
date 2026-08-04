import { NO_ENVIRONMENT_BINDING, RevisionModel } from "shared/permissions";
import { isArchiveTransition } from "shared/util";
import { Revision, RevisionTargetType } from "shared/enterprise";
import { logger } from "back-end/src/util/logger";
import { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import {
  createOrUpdateRevision,
  applyPatchToSnapshot,
  buildPatchOps,
} from "back-end/src/revisions/util";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";

export type RevertStrategy = "draft" | "publish";

/**
 * Restoring a historical revision is one operation with two modes, and it was
 * implemented twelve times — once per entity per surface. That is why revert
 * produced more findings than any other verb in the permission split: each
 * implementation re-derived what "restore revision N" means and re-decided the
 * authority for landing it, and the four authority classes a revert can span
 * (project move, archive flip, environment footprint, holdout) were classified
 * independently every time.
 *
 * This module owns all of it: the target state, the change set, the authority
 * decision, and the two strategies.
 */

/**
 * The state a historical revision described once published: its own snapshot with
 * its own proposed changes applied. Every revert answers to this and nothing else.
 */
export function revertTargetState(
  targetRevision: Pick<Revision, "target">,
): Record<string, unknown> {
  return applyPatchToSnapshot(
    targetRevision.target.snapshot as Record<string, unknown>,
    targetRevision.target.proposedChanges,
  ) as Record<string, unknown>;
}

/**
 * Resolve the strategy the way every surface documents it: a draft unless the org
 * enables "reverts bypass approval", which makes an immediate publish the default.
 * Callers pass the requested strategy through verbatim.
 */
export function resolveRevertStrategy(
  requested: RevertStrategy | undefined,
  revertsBypassApproval: boolean,
): RevertStrategy {
  return requested ?? (revertsBypassApproval ? "publish" : "draft");
}

/**
 * Authority for a revert, in one place.
 *
 * `landing` is the whole distinction that kept going wrong: staging a revert
 * publishes nothing, so it answers for the project; landing one writes live state,
 * so it answers for the environments the restoration reaches. Deriving both from
 * the landing footprint locked environment-limited reverters out of even
 * proposing, and deriving both from the project let them land.
 *
 * A revert also restores whatever the target revision held, so it can span
 * authority classes the revert atom does not cover on its own: relocating the
 * entity takes authority in the destination, and restoring an archived state is
 * delete-class because it takes the entity out of service.
 */
export function assertCanRevertRevision({
  context,
  entityType,
  entity,
  fields,
  landing,
  footprint,
}: {
  context: Context;
  // The permission-layer model, not the adapter registry: Feature Flags keep
  // their own revision store but answer to the same authority rules, and the
  // authority decision never touches an adapter.
  entityType: RevisionModel;
  entity: Record<string, unknown>;
  fields: Record<string, unknown>;
  landing: boolean;
  footprint: string[];
}): void {
  const scope = landing ? footprint : NO_ENVIRONMENT_BINDING;
  const scoped = entity as { project?: string; projects?: string[] };

  // The revert atom and nothing else. Publish subsumes revert when PUBLISHING a
  // revision that happens to be a pure revert — that rule belongs to the publish
  // engine — but the revert action itself is its own authority, which is the whole
  // point of a revert-only incident responder and of a publisher who cannot
  // rewrite history. Accepting publish here let publisher, creatorPublisher and
  // editor revert Configs, which the persona matrix refuses.
  const holdsRevert = context.permissions.canRevisionAction(
    entityType,
    "revert",
    scoped,
    scope,
  );

  // Staging is also open to anyone who can author drafts; landing is not.
  const permitted =
    holdsRevert ||
    (!landing &&
      context.permissions.canRevisionAction(
        entityType,
        "draft",
        scoped,
        NO_ENVIRONMENT_BINDING,
      ));
  if (!permitted) context.permissions.throwPermissionError();

  // Relocating the entity is a write to the destination, whichever mode this is.
  if (
    !holdsMoveDestination({
      permissions: context.permissions,
      model: entityType,
      action: landing ? "revert" : "draft",
      existing: scoped,
      proposed: { ...scoped, ...fields },
      environments: scope,
    })
  ) {
    context.permissions.throwPermissionError();
  }

  // Restoring an archived state takes the entity out of service, so it carries
  // the delete atom wherever it lands. Only relevant once it actually lands.
  if (
    landing &&
    isArchiveTransition({
      proposed: "archived" in fields ? !!fields.archived : undefined,
      current: entity.archived as boolean | undefined,
    }) &&
    !context.permissions.canRevisionAction(entityType, "delete", scoped, scope)
  ) {
    context.permissions.throwPermissionError();
  }
}

/**
 * Land a direct change on the live entity, recording it as a merged revision.
 *
 * Every path that writes live state without a prior draft goes through here: the
 * three revert handlers and the three "no draft mode" update endpoints. They
 * disagreed on the one thing that matters — Config and Constant recorded history
 * first, Saved Group wrote live state first, which cannot be repaired by a retry
 * because the live change is already visible with no record of it.
 *
 * History first is the answer: a merged revision with no live change is
 * detectable and removable, and stranded-merge recovery exists for exactly that.
 * The reverse is silent. When the write fails the record is removed, and a
 * failure to remove it is reported rather than swallowed — phantom history is
 * worse than the original error, and only a human can reconcile it.
 *
 * `write` stays with the caller because the writes genuinely differ:
 * `adapter.applyChanges` re-runs entity normalization and cascades to dependents,
 * while the update endpoints write the model directly.
 */
export async function landDirectChange<T>({
  context,
  entityType,
  entity,
  patchOps,
  title,
  bypass,
  revertedFrom,
  write,
}: {
  context: Context;
  entityType: Parameters<typeof getAdapter>[0];
  entity: Record<string, unknown> & { id: string };
  patchOps: ReturnType<typeof buildPatchOps>;
  title?: string;
  bypass: boolean;
  // Set only when this change restores a historical revision.
  revertedFrom?: string;
  write: () => Promise<T>;
}): Promise<{ merged: Revision; result: T }> {
  const merged = await context.models.revisions.createMerged({
    type: entityType,
    id: entity.id,
    snapshot: entity,
    proposedChanges: patchOps,
    bypass,
    title,
    ...(revertedFrom ? { revertedFrom } : {}),
  });

  let result: T;
  try {
    result = await write();
  } catch (e) {
    try {
      await context.models.revisions.deleteById(merged.id);
    } catch (rollbackErr) {
      logger.error(
        rollbackErr,
        `Direct change to ${entityType} ${entity.id} failed to apply AND failed to remove its merged revision ${merged.id}; that revision is phantom history and needs removing by hand`,
      );
    }
    throw e;
  }

  return { merged, result };
}

/** Land a revert: `landDirectChange` with the adapter's apply and revert provenance. */
export async function applyRevertDirectly({
  context,
  entityType,
  entity,
  fields,
  patchOps,
  targetRevisionId,
  title,
  bypass,
}: {
  context: Context;
  entityType: Parameters<typeof getAdapter>[0];
  entity: Record<string, unknown> & { id: string };
  fields: Record<string, unknown>;
  patchOps: ReturnType<typeof buildPatchOps>;
  targetRevisionId: string;
  title?: string;
  bypass: boolean;
}): Promise<Revision> {
  const { merged } = await landDirectChange({
    context,
    entityType,
    entity,
    patchOps,
    title,
    bypass,
    revertedFrom: targetRevisionId,
    write: () =>
      getAdapter(entityType).applyChanges(context, entity, fields, {
        isRevert: true,
      }),
  });
  return merged;
}

/**
 * The revert pipeline: one order, for every entity and surface.
 *
 * All three handlers this replaces already ran these steps in this sequence, with
 * entity specifics in exactly two places. Making the order explicit is what closes
 * the class a narrow chokepoint cannot: a handler omitting a step, or running it in
 * the wrong place. The findings behind this were all step-ordering — a merged record
 * written before the authority decision, an experiment guard enforced ad hoc
 * "because this path calls applyChanges directly", gates collected before the
 * coarse check.
 *
 * `validate` and `assertLandable` are the entity's own slots: cross-field
 * validation and value checks in the first, production-affecting guards that only
 * apply when the change actually lands in the second. Dispatch is not a slot — the
 * webhook adapter is already registered per entity, so the pipeline looks it up and
 * three handlers stop remembering to fire it.
 */
export async function revertRevision({
  context,
  entityType,
  entity,
  targetRevision,
  strategy,
  fields,
  patchOps,
  footprint,
  title,
  bypass,
  validate,
  assertLandable,
}: {
  context: Context;
  // Narrower than the authority decision's `RevisionModel` on purpose: the
  // pipeline writes generic revisions, which Feature Flags do not use — they keep
  // their own revision store. Features share `assertCanRevertRevision` and will
  // join this pipeline when that store is unified.
  entityType: RevisionTargetType;
  entity: Record<string, unknown> & { id: string };
  targetRevision: Revision;
  strategy: RevertStrategy;
  fields: Record<string, unknown>;
  patchOps: ReturnType<typeof buildPatchOps>;
  footprint: string[];
  title?: string;
  bypass: boolean;
  /** Entity validation, run for both strategies before anything is written. */
  validate?: () => Promise<void>;
  /** Guards that only bite when the change lands live. */
  assertLandable?: () => Promise<void>;
}): Promise<{ revision: Revision; published: boolean }> {
  const landing = strategy === "publish";

  assertCanRevertRevision({
    context,
    entityType,
    entity,
    fields,
    landing,
    footprint,
  });

  await validate?.();

  const dispatch = getRevisionWebhookAdapter(entityType);

  if (!landing) {
    const draft = await createOrUpdateRevision(
      context as Parameters<typeof createOrUpdateRevision>[0],
      entityType,
      entity,
      patchOps,
      { forceCreate: true, title, revertedFrom: targetRevision.id },
    );
    await dispatch?.dispatch(context, draft, { type: "created" });
    return { revision: draft, published: false };
  }

  await assertLandable?.();

  const merged = await applyRevertDirectly({
    context,
    entityType,
    entity,
    fields,
    patchOps,
    targetRevisionId: targetRevision.id,
    title,
    bypass,
  });
  await dispatch?.dispatch(context, merged, { type: "reverted" });
  return { revision: merged, published: true };
}
