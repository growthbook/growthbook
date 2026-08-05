import { NO_ENVIRONMENT_BINDING, RevisionModel } from "shared/permissions";
import { isArchiveTransition } from "shared/util";
import { Revision, RevisionTargetType } from "shared/enterprise";
import { logger } from "back-end/src/util/logger";
import {
  assertLandingBaseline,
  LandingConflictError,
  runGuardedWrite,
  tryRestoreEntityPreImage,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import { CasConflictError, Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import {
  ensureLiveRevisionExists,
  createOrUpdateRevision,
  applyPatchToSnapshot,
  buildPatchOps,
} from "back-end/src/revisions/util";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";

export type RevertStrategy = "draft" | "publish";

// Everything a revert needs: the target state, the change set, the authority
// decision, and the two strategies (stage a draft, or land it).

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

// Revert authority. `landing` is the distinction that matters: staging publishes
// nothing so it answers for the project, while landing answers for the environments
// the restoration reaches.
//
// A revert restores whatever the target held, so it can span classes the revert atom
// does not cover: relocating takes authority in the destination, and restoring an
// archived state is delete-class.
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

// Land a change that has no prior draft, recording it as a merged revision first.
//
// History before live state, deliberately: a merged revision with no live change
// is detectable and removable (stranded-merge recovery exists for it), whereas a
// live change with no record of it is silent and no retry can repair it.
//
// Sequencing is the bulk pipeline's, via `assertLandingBaseline`: the entity must
// still be where the change was computed from, and this landing's own merged
// revision must still be the newest — a concurrent landing that recorded newer
// intent wins, and this one aborts with a retryable conflict rather than applying
// older state over it.
//
// `write` stays with the caller: applyChanges re-runs normalization and cascades
// to dependents, while the update endpoints write the model directly.
export async function landDirectChange<T>({
  context,
  entityType,
  entity,
  patchOps,
  title,
  bypass,
  revertedFrom,
  changes,
  afterRestore,
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
  // The fields this landing writes. Enables compensation when a multi-step write
  // (an entity update that then cascades to dependents) fails partway; omit for a
  // write that is atomic on one document.
  changes?: Record<string, unknown>;
  // Re-runs whatever the write cascaded to, after the entity itself is restored.
  // Restoring the root does not un-reconcile dependents the failed write already
  // touched, so a path that cascades supplies the cascade again here. Treated like
  // the restore itself: if it fails, live is still mid-change and the merged
  // revision is kept as the record.
  afterRestore?: () => Promise<void>;
  write: () => Promise<T>;
}): Promise<{ merged: Revision; result: T }> {
  return withBufferedPayloadRefreshes(context, "direct-landing", async () => {
    const baselineDateUpdated =
      (entity as { dateUpdated?: Date }).dateUpdated ?? null;
    // Before recording anything: a landing computed against a stale read must not
    // become history at all.
    await assertLandingBaseline({
      context,
      entityType,
      entityId: entity.id,
      baselineDateUpdated,
    });

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
    // Whether the entity write was reached. Compensation is only ever right for a
    // write that STARTED: the restore decides ownership by comparing live to the
    // value this landing intended, so running it after a pre-write refusal would
    // mistake a concurrent landing's identical value for our own and undo it.
    let writeStarted = false;
    try {
      // Re-checked now that this landing has a place in the order: still the newest
      // merged revision, and the entity still untouched since the baseline. The
      // write itself is guarded on the same baseline, so the gap between this check
      // and that write is not a window a concurrent landing can slip through.
      await assertLandingBaseline({
        context,
        entityType,
        entityId: entity.id,
        baselineDateUpdated,
        requireLatestMergedId: merged.id,
      });
      writeStarted = true;
      result = await write();
    } catch (e) {
      // Live state first: an unrecorded partial change is the one outcome no retry
      // can repair, so the merged revision is only removed once live is back where
      // it started. When it can't be, the revision is KEPT as the record of what
      // actually happened, and the original failure still surfaces.
      //
      // A rejected CAS is different from a failed write: the guarded write is the
      // landing's first write, so losing it means NOTHING was written — and
      // compensating would compare live against values this landing never wrote,
      // mistake a winner's identical values for its own, and undo them.
      const casLost =
        e instanceof LandingConflictError || e instanceof CasConflictError;
      let restored =
        changes && writeStarted && !casLost
          ? await tryRestoreEntityPreImage({
              context,
              entityType,
              preImage: entity,
              persistedKeys: Object.keys(changes),
              written: changes,
            })
          : true;
      if (restored && writeStarted && !casLost && afterRestore) {
        try {
          await afterRestore();
        } catch (cascadeErr) {
          restored = false;
          logger.error(
            cascadeErr,
            `Direct change to ${entityType} ${entity.id} was rolled back but its dependents could not be re-reconciled; its merged revision is kept as the record`,
          );
        }
      }
      if (restored) {
        try {
          // The landing's own authority was established before this point, and the
          // revision exists only because of it — so removing it is not a fresh
          // delete decision. Without the bypass a revert-only caller's failed write
          // leaves phantom merged history it has no permission to clean up.
          await context.models.revisions.dangerousDeleteByIdBypassPermission(
            merged.id,
          );
        } catch (rollbackErr) {
          logger.error(
            rollbackErr,
            `Direct change to ${entityType} ${entity.id} failed to apply AND failed to remove its merged revision ${merged.id}; that revision is phantom history and needs removing by hand`,
          );
        }
      }
      throw e;
    }

    return { merged, result };
  });
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
    changes: fields,
    write: () =>
      runGuardedWrite(entityType, entity.id, () =>
        getAdapter(entityType).applyChanges(context, entity, fields, {
          isRevert: true,
          guarded: true,
        }),
      ),
  });
  return merged;
}

// The revert order, owned centrally so a handler cannot omit a step or run one in
// the wrong place.
//
// The entity's own work goes in two slots: `validate` for cross-field and value
// checks, `assertLandable` for guards that only bite once the change lands. The
// webhook is looked up from the registry rather than passed in.
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
  validate,
  resolveApproval,
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
  /** Entity validation, run for both strategies before anything is written. */
  validate?: () => Promise<void>;
  // Resolve whether this landing needs approval and whether the caller may bypass
  // it, and refuse if not. Runs only when landing, and only AFTER authority —
  // refusing for authority outranks refusing for process, and having each handler
  // order that itself is what got it backwards.
  resolveApproval?: () => Promise<{
    approvalRequired: boolean;
    canBypass: boolean;
  }>;
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

  // Only now: this writes a revision row for an entity with no history yet, and a
  // refused revert must leave nothing behind. Handlers used to call it themselves,
  // before the authoritative check.
  await ensureLiveRevisionExists(
    context as Parameters<typeof ensureLiveRevisionExists>[0],
    entityType,
    entity,
  );

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

  const approval = await resolveApproval?.();

  await assertLandable?.();

  const merged = await applyRevertDirectly({
    context,
    entityType,
    entity,
    fields,
    patchOps,
    targetRevisionId: targetRevision.id,
    title,
    bypass: !!approval?.approvalRequired && !!approval?.canBypass,
  });
  await dispatch?.dispatch(context, merged, { type: "reverted" });
  return { revision: merged, published: true };
}
