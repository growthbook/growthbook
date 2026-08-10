import { isEqual } from "lodash";
import type { RevisionTargetType } from "shared/enterprise";
import { getAdapter } from "back-end/src/revisions";
import { CasConflictError, Context } from "back-end/src/models/BaseModel";
import type { DeferredEventBuffer } from "back-end/src/events/bulkPublishCorrelation";
import { entityKey } from "back-end/src/events/bulkPublishCorrelation";
import { ConflictError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { displayEntityName } from "back-end/src/revisions/entityNames";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import { applyVerifiedRestore } from "back-end/src/revisions/bulkPublish/verifiedRestore";

// The write sequencing every landing shares: check the baseline the change was
// computed from before writing, and put live state back when the write fails partway.
// Optimistic checks only — no transactions, so DocumentDB/CosmosDB stay supported.
//
// The pre-flight read is separate from the pre-write one on purpose: a doomed landing
// that never becomes history can't leave phantom history if its removal then fails.

// Nothing was written. Its own class so compensation can tell it from a write that
// failed partway: restoring after a rejected CAS would compare live against values this
// landing never wrote, mistake the winner's identical values for its own, and undo them.
export class LandingConflictError extends ConflictError {
  constructor(entityType: RevisionTargetType | "feature", entityId: string) {
    super(
      `${displayEntityName(entityType)} "${entityId}" changed while this was being applied — nothing was written; retry`,
    );
    this.name = "LandingConflictError";
  }
}

function landingConflictError(
  entityType: RevisionTargetType | "feature",
  entityId: string,
): ConflictError {
  return new LandingConflictError(entityType, entityId);
}

// Turns a lost CAS race into the same retryable conflict a failed baseline check gives.
// The guard is what closes the check/write gap: `assertLandingBaseline` proves the
// baseline held a moment ago, the guard proves it still held at the write.
export async function runGuardedWrite<T>(
  entityType: RevisionTargetType | "feature",
  entityId: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof CasConflictError) {
      throw landingConflictError(entityType, entityId);
    }
    throw e;
  }
}

/**
 * The post-write half of the landing order, for every path that lands a revision.
 *
 * The merge claim and the entity write live in different collections and there are
 * no transactions here, so a newer revision can claim the merge between the
 * pre-write check and this one. Its claim never touches the entity, so an entity
 * CAS guard cannot catch it.
 *
 * Detection, not exclusion: the loser has already written, so it throws into its
 * caller's compensation and both revisions stay retryable.
 */
export async function assertLandingStillOwned({
  context,
  entityType,
  entityId,
  mergedId,
  /**
   * The entity stamp AFTER this apply, when the applier reported one. Omitted when
   * it cannot: comparing a fresh re-read against itself would only look like a
   * second check.
   */
  expectedDateUpdated,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entityId: string;
  mergedId: string;
  expectedDateUpdated?: Date | null;
}): Promise<void> {
  if (expectedDateUpdated !== undefined) {
    await assertLandingBaseline({
      context,
      entityType,
      entityId,
      baselineDateUpdated: expectedDateUpdated,
      requireLatestMergedId: mergedId,
    });
    return;
  }

  const latest = await context.models.revisions.getLatestMergedByTarget(
    entityType,
    entityId,
  );
  if (!latest || latest.id !== mergedId) {
    throw landingConflictError(entityType, entityId);
  }
}

/**
 * The baseline a landing computed its change from, and the identity of the merged
 * revision recording it. Re-checked immediately before the entity write.
 */
export async function assertLandingBaseline({
  context,
  entityType,
  entityId,
  baselineDateUpdated,
  requireLatestMergedId,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entityId: string;
  /** `dateUpdated` of the entity the change was computed against. */
  baselineDateUpdated: Date | null;
  // When set, this revision must still be the newest merged one for the target — a
  // newer merge supersedes this one, so applying would overwrite it with older state.
  requireLatestMergedId?: string;
}): Promise<void> {
  const fresh = await getAdapter(entityType)
    .getModel(context)
    ?.getById(entityId);
  const current = (fresh as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
  if (
    (current?.getTime() ?? null) !== (baselineDateUpdated?.getTime() ?? null)
  ) {
    throw landingConflictError(entityType, entityId);
  }

  if (requireLatestMergedId) {
    const latest = await context.models.revisions.getLatestMergedByTarget(
      entityType,
      entityId,
    );
    // A NULL latest is a failure too, not a pass: the caller just created that
    // row, so its absence means it is gone, and passing would land the entity
    // write with no history recording it.
    if (!latest || latest.id !== requireLatestMergedId) {
      throw landingConflictError(entityType, entityId);
    }
  }
}

// Put back the fields a failed write persisted. Restores a key only while live still
// holds the value this apply wrote — value-based, so a concurrent writer who set the
// same value is indistinguishable; that residual closes only by CAS-guarding the apply.
//
// Throws when the restore can't complete: callers keep the merged revision, since a
// recorded partial change can be reconciled by hand and an unrecorded one cannot.
//
// The `dateUpdated`/audit residue a restore leaves is deliberate — these writes
// happened, and a rollback that erased its tracks would hide what the system did.
export async function restoreEntityPreImage({
  context,
  entityType,
  preImage,
  persistedKeys,
  written,
}: {
  context: Context;
  entityType: RevisionTargetType;
  /** The entity as it was before the failed write. */
  preImage: Record<string, unknown> & { id: string };
  // What the apply reported persisting, or the intended changes if it threw before
  // reporting: the value check makes the difference harmless, since a key the apply
  // never wrote restores to itself.
  persistedKeys: Iterable<string>;
  /** The values the apply intended to write, for the "do we still own it" test. */
  written: Record<string, unknown>;
}): Promise<void> {
  const adapter = getAdapter(entityType);
  // Read-decide-write under the same guard as any landing, retried: the restore
  // decides ownership from a read, and a newer landing arriving between that
  // read and an unguarded write would be replaced by the stale pre-image. A CAS
  // loss here means someone else changed the doc — re-read, re-decide ownership
  // (their keys drop out of the restore by value), and try again.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const current = await adapter.getModel(context)?.getById(preImage.id);
    if (!current) {
      throw new Error(
        `landing compensation: ${entityType} "${preImage.id}" no longer exists — cannot restore its pre-image`,
      );
    }

    const restore = ownedRestoreValues({
      keys: persistedKeys,
      preImage,
      written,
      current: current as Record<string, unknown>,
    });
    try {
      await applyVerifiedRestore({
        restore,
        current: current as Record<string, unknown>,
        label: `${entityType} "${preImage.id}"`,
        // A pre-image is a state that was already live, so the restore is a
        // revert: skip the validations that exist to judge new intent.
        write: async (values) =>
          (
            await adapter.applyChanges(context, current, values, {
              isRevert: true,
              guarded: true,
            })
          ).persistedKeys,
      });
      // Dependents the failed cascade already touched answer to the restored
      // root, not the one that was rolled back — the adapter re-runs its own
      // cascade when the restored keys call for it. An EMPTY restore means a
      // rival owns the root, and the rival's own apply reconciled dependents to
      // it; re-running here would act on state that isn't ours.
      const restoredKeys = Object.keys(restore);
      // Recorded BEFORE the repair cascade, which can throw: by here the
      // document's own restore has committed, so its id must be recorded even
      // if the repair fails.
      context.bulkPublishRestoredEntities?.add(
        entityKey(entityType, preImage.id),
      );
      if (restoredKeys.length) {
        // The repair cascade's writes stay: the repair strips a descendant's
        // field BECAUSE the restored root declares it, so a rollback would be
        // normalized right back. That end state is base-wins-correct — the
        // descendant re-inherits the value from the root.
        await adapter.afterRestorePreImage?.(context, current, restoredKeys);
      }
      return;
    } catch (e) {
      if (e instanceof CasConflictError && attempt < maxAttempts) continue;
      throw e;
    }
  }
}

// Whether live still holds exactly what the changes intended — i.e. the write landed.
// Lets a landing that raced report success instead of asking the caller to retry.
export function liveMatchesDesiredState({
  live,
  desiredState,
  updatableFields,
}: {
  live: Record<string, unknown> | null;
  desiredState: Record<string, unknown>;
  updatableFields: ReadonlySet<string>;
}): boolean {
  if (!live) return false;
  return Object.keys(desiredState).every(
    (key) => !updatableFields.has(key) || isEqual(desiredState[key], live[key]),
  );
}

/** Best-effort compensation, for paths that must report the original failure. */
export async function tryRestoreEntityPreImage(
  args: Parameters<typeof restoreEntityPreImage>[0],
): Promise<boolean> {
  try {
    await restoreEntityPreImage(args);
    return true;
  } catch (e) {
    logger.error(
      e,
      `landing compensation failed for ${args.entityType} "${args.preImage.id}" — live state is left mid-change and its merged revision is kept as the record`,
    );
    return false;
  }
}

// Detach the buffer and issue ONE deduped refresh: `refreshSDKPayloadCache` rebuilds
// each affected connection once per call, so one call = one rebuild per connection.
export function flushPayloadRefreshBuffer(
  context: Context,
  event: string,
): void {
  const buffer = context.sdkPayloadRefreshBuffer;
  context.sdkPayloadRefreshBuffer = null;
  if (!buffer) return;
  // Closed: straggler producers fall through to live refreshes instead of
  // pushing into a drained array.
  buffer.closed = true;
  if (!buffer.keys.length) return;
  const seen = new Set<string>();
  const keys = buffer.keys.filter((k) => {
    const id = `${k.environment}||${k.project}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  queueSDKPayloadRefresh({
    context,
    payloadKeys: keys,
    treatEmptyProjectAsGlobal: buffer.treatEmptyProjectAsGlobal,
    auditContext: { event, model: "release" },
  });
}

// Buffer a landing's SDK refreshes and flush ONCE when it settles. A multi-step apply
// (config root then cascade; feature write then holdout pointer) otherwise briefly
// broadcasts the mid-landing mix. Refreshes rebuild from live state at flush time, so
// one flush in `finally` serves the landed state on success and the restored state after
// compensation. A scope already holding a buffer keeps charge of its own flush.
export async function withBufferedPayloadRefreshes<T>(
  context: Context,
  event: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (context.sdkPayloadRefreshBuffer) return fn();
  context.sdkPayloadRefreshBuffer = {
    keys: [],
    treatEmptyProjectAsGlobal: false,
  };
  // `*.updated` events defer alongside the refreshes: a landing that compensates would
  // otherwise have told consumers about a change that no longer exists.
  // A CLOSED buffer left by an EARLIER landing is not an enclosing scope — reusing
  // it would hand that landing's verdict to this one.
  const outer = context.bulkPublishDeferredEvents;
  const outerDeferred = outer && !outer.closed ? outer : null;
  const buffer: DeferredEventBuffer = {
    entries: [],
    restored: new Set<string>(),
  };
  context.bulkPublishDeferredEvents = buffer;
  // Where `restoreEntityPreImage` and the feature rewind report what they put back.
  const outerRestored = context.bulkPublishRestoredEntities;
  context.bulkPublishRestoredEntities = buffer.restored;
  try {
    const result = await fn();
    const deferred = buffer.entries;
    // The landing stands, so nothing is in `restored` and every straggler emits. The
    // buffer belongs to the landing, not the context: hand the context back to an
    // enclosing release, or to nothing. A suspended producer holds its own reference.
    buffer.closed = true;
    context.bulkPublishDeferredEvents = outerDeferred;
    for (const { emit } of deferred) {
      // Best effort, one at a time: a consumer failure must not undo a landing
      // that has already committed.
      await emit().catch((e) =>
        logger.error(e, `Deferred ${event} event failed to dispatch`),
      );
    }
    return result;
  } catch (e) {
    const deferred = buffer.entries;
    // Whatever survived is already decided. A straggler is judged per document by
    // `buffer.restored`, exactly like the entries below.
    buffer.closed = true;
    context.bulkPublishDeferredEvents = outerDeferred;
    // Normally dropped: a rolled-back change never happened. But compensation
    // that FAILED leaves part of it live, and consumers have to hear about state
    // that exists — the refresh in `finally` already serves that state.
    if (context.landingLeftPartialState) {
      context.landingLeftPartialState = false;
      // Per DOCUMENT, like the bulk path: a Config root can be restored while a
      // descendant of the same landing is not, and emitting the root's event then
      // asserts the published value over live pre-image state.
      for (const { owner, emit } of deferred) {
        if (buffer.restored.has(owner)) continue;
        await emit().catch((err: unknown) =>
          logger.error(err, `Deferred ${event} event failed to dispatch`),
        );
      }
    }
    throw e;
  } finally {
    context.bulkPublishRestoredEntities = outerRestored;
    flushPayloadRefreshBuffer(context, event);
  }
}

/**
 * Compensate a failed landing that had already claimed its merge: put LIVE state
 * back first, then un-merge the revision — and un-merge only when the restore came
 * back clean.
 *
 * The ordering is the whole point: a live change with no record is the one outcome
 * nothing can repair, so the record is kept whenever live cannot be put back.
 *
 * `persisted` is what the write REPORTED writing. Nothing reported means the write
 * never landed (models report from inside the document write, before audit and the
 * afterUpdate hooks), so there is nothing to restore.
 */
export async function compensateFailedLanding({
  context,
  entityType,
  entity,
  persisted,
  changes,
  cascade = [],
  unmerge,
}: {
  context: Context;
  entityType: RevisionTargetType;
  entity: Record<string, unknown> & { id: string };
  persisted: Record<string, unknown> | null;
  /** The fields this landing meant to write, for the ownership comparison. */
  changes: Record<string, unknown>;
  /**
   * Writes a cascade made to OTHER entities on this landing's behalf, each with
   * its own pre-image. Restored AFTER the root — see the ordering note below.
   */
  cascade?: {
    before: Record<string, unknown> & { id: string };
    written: Record<string, unknown>;
  }[];
  /** Returns the revision to its pre-merge state. */
  unmerge: () => Promise<unknown>;
}): Promise<void> {
  // ROOT FIRST, then descendants top-down. A restore writes through
  // `applyChanges({isRevert: true})`, where ancestor normalization is
  // unconditional — while the root still declares a field, a descendant's
  // restore is normalized straight back to the stripped schema, and the
  // verification reports success because nothing looks dropped. Restore the
  // root first and each descendant's restore survives; descendants then go
  // parents-before-children because a child normalizes against ancestors that
  // must already be back.
  const restored =
    persisted === null
      ? true
      : await tryRestoreEntityPreImage({
          context,
          entityType,
          preImage: entity,
          persistedKeys: Object.keys(changes),
          written: persisted,
        });

  let cascadeRestored = true;
  for (const write of cascade) {
    const ok = await tryRestoreEntityPreImage({
      context,
      entityType,
      preImage: write.before,
      persistedKeys: Object.keys(write.written),
      written: write.written,
    });
    if (!ok) cascadeRestored = false;
  }

  if (!restored || !cascadeRestored) {
    // Part of the change is live, so consumers must hear about it and the merged
    // revision stays as the record of what actually happened.
    context.landingLeftPartialState = true;
    logger.error(
      `Landing on ${entityType} "${entity.id}" failed and live state could not be restored; its merged revision is kept as the record and needs reconciling by hand`,
    );
    return;
  }

  try {
    await unmerge();
  } catch (e) {
    logger.error(
      e,
      `Landing on ${entityType} "${entity.id}" was rolled back but its merged revision could not be un-merged; that revision is phantom history and needs removing by hand`,
    );
  }
}
