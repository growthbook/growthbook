import { NO_ENVIRONMENT_BINDING, RevisionModel } from "shared/permissions";
import { isArchiveTransition } from "shared/util";
import { Revision, RevisionTargetType } from "shared/enterprise";
import { logger } from "back-end/src/util/logger";
import {
  assertLandingBaseline,
  assertLandingStillOwned,
  restoreLandingWrites,
  runGuardedWrite,
  withBufferedPayloadRefreshes,
} from "back-end/src/revisions/landingSequence";
import { Context } from "back-end/src/models/BaseModel";
import { getAdapter } from "back-end/src/revisions";
import { assertCanPublishRevision } from "back-end/src/revisions/revisionActions";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import {
  ensureLiveRevisionExists,
  createOrUpdateRevision,
  applyPatchToSnapshot,
  buildPatchOps,
} from "back-end/src/revisions/util";
import { holdsMoveDestination } from "back-end/src/revisions/moveAuthority";
import type {
  BypassedGate,
  BypassVia,
} from "back-end/src/revisions/publishGates";

export type RevertStrategy = "draft" | "publish";

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

  // The revert atom and nothing else. Publish subsumes revert only when
  // PUBLISHING a revision that happens to be a pure revert — that rule belongs
  // to the publish engine. The revert action is its own authority: that is the
  // whole point of a revert-only incident responder, and of a publisher who
  // cannot rewrite history.
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

  // Restoring an archived state takes the entity out of service, so once it
  // lands it carries the delete atom on BOTH sides: a revert target can restore
  // an older PROJECT alongside `archived`, so delete must hold in the source
  // (where the entity is taken out of service) and the destination (where it
  // lands archived).
  if (
    landing &&
    isArchiveTransition({
      proposed: "archived" in fields ? !!fields.archived : undefined,
      current: entity.archived as boolean | undefined,
    }) &&
    (!context.permissions.canRevisionAction(
      entityType,
      "delete",
      scoped,
      scope,
    ) ||
      !holdsMoveDestination({
        permissions: context.permissions,
        model: entityType,
        action: "delete",
        existing: scoped,
        proposed: { ...scoped, ...fields },
        environments: scope,
      }))
  ) {
    context.permissions.throwPermissionError();
  }
}

// Land a change with no prior draft, recording it as a merged revision FIRST: a merged
// revision with no live change is detectable and removable, whereas a live change with
// no record is silent and unrepairable.
//
// `assertLandingBaseline` requires both that the entity is still where the change was
// computed from and that this landing's revision is still the newest merged one — a
// concurrent landing that recorded newer intent wins.
//
// `write` stays with the caller: applyChanges cascades to dependents, while the update
// endpoints write the model directly.
export async function landDirectChange<T>({
  context,
  entityType,
  entity,
  patchOps,
  title,
  bypass,
  revertedFrom,
  changes,
  write,
  persistedFrom,
  cascade,
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
  write: (report: (doc: Record<string, unknown> | null) => void) => Promise<T>;
  // The doc the write PERSISTED — the ownership baseline compensation compares
  // live against. Adapters and model hooks normalize, so the caller's intended
  // `changes` is not it. Maps the write's return value; `write` also receives a
  // `report` callback for when the write throws AFTER persisting (a Config
  // cascade) and there is no return value to map.
  persistedFrom?: (result: T) => Record<string, unknown> | null;
  // Writes the landing made to OTHER entities on its behalf — a Config's
  // descendant cascade — each with its own pre-image. Restored AFTER the root:
  // a descendant put back while the root still declares the field is
  // re-stripped by ancestor normalization while reporting success. A thunk
  // because the root write reports BEFORE the cascade runs.
  cascade?: () => {
    before: Record<string, unknown> & { id: string };
    written: Record<string, unknown>;
  }[];
}): Promise<{ merged: Revision; result: T }> {
  return withBufferedPayloadRefreshes(context, "direct-landing", async () => {
    // The same landing gate the revision engine runs, on the landing's own
    // evidence. Every caller asserts its own verb-shaped variant first (clearer
    // errors); this one exists so a caller that under-asserts is not a bypass.
    await assertCanPublishRevision(
      context,
      {
        target: {
          type: entityType,
          id: entity.id,
          snapshot: entity,
          proposedChanges: patchOps,
        },
        ...(revertedFrom ? { revertedFrom } : {}),
      } as Revision,
      entity,
      // A direct revert relocation takes REVERT authority on the destination
      // (the verb-shaped primary check does the same); a direct non-revert
      // landing is a publish. Matches `assertCanRevertRevision`'s move check.
      revertedFrom ? "revert" : "publish",
    );

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
    let persisted: Record<string, unknown> | null = null;
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
      result = await write((doc) => {
        persisted = doc;
      });
      persisted = persistedFrom?.(result) ?? persisted;

      // The post-write half of the order. The pre-check above establishes it; the
      // entity guard only excludes a concurrent ENTITY write, and a newer revision's
      // merge CLAIM is not one — so without this a direct landing could write older
      // state under newer history and never notice.
      await assertLandingStillOwned({
        context,
        entityType,
        entityId: entity.id,
        mergedId: merged.id,
        expectedDateUpdated:
          (persisted as { dateUpdated?: Date } | null)?.dateUpdated ??
          baselineDateUpdated,
      });
    } catch (e) {
      // Live state first: an unrecorded partial change is the one outcome no
      // retry can repair, so the revision is removed only once live is back —
      // and KEPT as the record when it can't be. "Nothing was written" is what
      // the REPORT says, not the error class: on the REST Config path a
      // descendant cascade raises CasConflictError raw, AFTER the root write
      // reported.
      const nothingReported = persisted === null || persisted === undefined;
      // Ownership against the PERSISTED doc, not the intent — the write path
      // normalizes, and comparing live to unnormalized changes misreads "ours"
      // as "someone else's". No re-read fallback: a re-read after failure can
      // observe a concurrent writer and hand compensation their values as if
      // this landing had written them.
      const written =
        changes && writeStarted && !nothingReported ? persisted : null;
      const compensating = !!changes && writeStarted && written !== null;
      // Nothing reported means the write never landed (the model reports from
      // inside it), so there is nothing to restore and the merged revision is
      // phantom history to be removed. Same restore primitive every landing
      // uses. `cascade` is read HERE, not at the call site: `onPersisted` fires
      // before the cascade runs, so anything captured then is still empty.
      const fullyRestored = await restoreLandingWrites({
        context,
        entityType,
        root:
          compensating && written !== null
            ? { preImage: entity, persistedKeys: Object.keys(changes), written }
            : null,
        cascade: cascade?.() ?? [],
      });
      // BOTH restores: gating on the root alone could delete the record while
      // a descendant is left stripped and live.
      if (fullyRestored) {
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
async function applyRevertDirectly({
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
  let cascadeRef:
    | {
        before: Record<string, unknown> & { id: string };
        written: Record<string, unknown>;
      }[]
    | undefined;
  const { merged } = await landDirectChange({
    context,
    entityType,
    entity,
    patchOps,
    title,
    bypass,
    revertedFrom: targetRevisionId,
    changes: fields,
    cascade: () => cascadeRef ?? [],
    write: (report) =>
      runGuardedWrite(entityType, entity.id, () =>
        getAdapter(entityType).applyChanges(context, entity, fields, {
          isRevert: true,
          guarded: true,
          onPersisted: (applied) => {
            report(applied.written);
            // The adapter's OWN array, held by reference — appended to as the
            // cascade proceeds, so compensation sees every descendant write.
            // Copying here would capture nothing: this fires before the
            // cascade runs.
            cascadeRef = applied.cascade;
          },
        }),
      ),
    persistedFrom: (applied) => applied.written,
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
  // Resolve whether this landing needs approval and whether the caller may
  // bypass it, refusing if not. Runs only when landing, and only AFTER
  // authority — refusing for authority outranks refusing for process.
  resolveApproval?: () => Promise<{
    approvalRequired: boolean;
    canBypass: boolean;
    // Which authority cleared the approval gate, for the response's
    // `bypassedGates`.
    bypassVia?: BypassVia;
    // The org's "reverts bypass approval" setting made approval NOT REQUIRED
    // for this landing. It never reaches `canBypass` (there is no gate left to
    // bypass), so it needs its own signal or the most common approval skip of
    // all goes unreported.
    settingSuppressedApproval?: boolean;
  }>;
  /** Guards that only bite when the change lands live. */
  assertLandable?: () => Promise<void>;
}): Promise<{
  revision: Revision;
  published: boolean;
  bypassedGates: BypassedGate[];
}> {
  const landing = strategy === "publish";

  assertCanRevertRevision({
    context,
    entityType,
    entity,
    fields,
    landing,
    footprint,
  });

  // Only after authority: this writes a revision row for an entity with no
  // history yet, and a refused revert must leave nothing behind.
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
    // A draft lands nothing, so it clears no publish gate.
    return { revision: draft, published: false, bypassedGates: [] };
  }

  const approval = await resolveApproval?.();

  await assertLandable?.();

  // Which authority (if any) let this landing skip an approval it would otherwise
  // have needed. Reported on the response so a revert that lands without review is
  // as traceable as a publish that does.
  const approvalBypassedVia: BypassVia | null =
    approval?.approvalRequired && approval.canBypass
      ? (approval.bypassVia ?? "bypassApprovalPermission")
      : approval?.settingSuppressedApproval
        ? "revertsBypassApproval"
        : null;

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
  // A revert that lands is ALSO a publish, so it owes both events: `reverted`
  // names what happened, `published` is the lifecycle event subscribers mirror
  // revision state from.
  await dispatch?.dispatch(context, merged, { type: "published" });
  await dispatch?.dispatch(context, merged, { type: "reverted" });
  return {
    revision: merged,
    published: true,
    bypassedGates: approvalBypassedVia
      ? [
          {
            type: "approval-required",
            outcome: "bypassed",
            via: approvalBypassedVia,
          },
        ]
      : [],
  };
}
