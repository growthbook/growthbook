import { isEqual } from "lodash";
import type { RevisionTargetType } from "shared/enterprise";
import { getAdapter } from "back-end/src/revisions";
import { CasConflictError, Context } from "back-end/src/models/BaseModel";
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
    // A NULL latest is a failure too, not a pass. The caller supplies
    // `requireLatestMergedId` for a row it just created, so its absence means that row
    // is gone — and treating that as "no competing merge" let the entity write land
    // with no history recording it, which is the one outcome nothing can repair.
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
      if (restoredKeys.length) {
        // The repair cascade's writes are deliberately NOT rolled back.
        //
        // I tried: reported them through the adapter contract, recursed, bounded the
        // recursion. It cannot work, for the same reason the descendants-first
        // ordering couldn't. The repair strips a field from a descendant precisely
        // BECAUSE the just-restored root declares it — so writing the descendant's
        // pre-image back sends it through the same unconditional ancestor
        // normalization, which strips it again, and reports success because the key
        // is still in `persistedKeys` and nothing looks dropped. The machinery was a
        // guaranteed no-op whose only real effects were a discarded failure signal, a
        // fail-open exhaustion branch, and one full config-collection load per repair
        // write inside an already-failing request.
        //
        // What the repair leaves is base-wins-correct given the restored root: the
        // root owns the field, so the descendant must not declare it. That is the
        // right resting state, not a loss — the field's value is still on the
        // descendant's document and re-inherits from the root.
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
  const outerDeferred = context.bulkPublishDeferredEvents;
  context.bulkPublishDeferredEvents = [];
  try {
    const result = await fn();
    const deferred = context.bulkPublishDeferredEvents ?? [];
    context.bulkPublishDeferredEvents = outerDeferred;
    for (const emit of deferred) {
      // Best effort, one at a time: a consumer failure must not undo a landing
      // that has already committed.
      await emit().catch((e) =>
        logger.error(e, `Deferred ${event} event failed to dispatch`),
      );
    }
    return result;
  } catch (e) {
    const deferred = context.bulkPublishDeferredEvents ?? [];
    context.bulkPublishDeferredEvents = outerDeferred;
    // Normally dropped: a rolled-back change never happened. But compensation
    // that FAILED leaves part of it live, and consumers have to hear about state
    // that exists — the refresh in `finally` already serves that state.
    if (context.landingLeftPartialState) {
      context.landingLeftPartialState = false;
      for (const emit of deferred) {
        await emit().catch((err) =>
          logger.error(err, `Deferred ${event} event failed to dispatch`),
        );
      }
    }
    throw e;
  } finally {
    flushPayloadRefreshBuffer(context, event);
  }
}

/**
 * Compensate a failed landing that had already claimed its merge: put LIVE state
 * back first, then un-merge the revision — and un-merge only when the restore came
 * back clean.
 *
 * The internal controllers hand-rolled this and stopped at the un-merge, so a
 * cascade failure after the root write left the change live with the revision
 * reopened: no merged revision, no webhook, SDKs already serving it. The ordering
 * is the whole point and it belongs in one place — a live change with no record is
 * the one outcome nothing can repair, so the record is kept whenever live cannot be
 * put back.
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
   * its own pre-image. Restored AFTER the root, and this ordering is load-bearing in
   * that direction: a restore runs through unconditional ancestor normalization, so
   * putting a descendant back while the root still declares the field strips it
   * again — and reports success, because the key is still in `persistedKeys` and
   * nothing looks dropped. Root first, and each descendant's restore survives.
   */
  cascade?: {
    before: Record<string, unknown> & { id: string };
    written: Record<string, unknown>;
  }[];
  /** Returns the revision to its pre-merge state. */
  unmerge: () => Promise<unknown>;
}): Promise<void> {
  // ROOT FIRST, then descendants top-down. The order matters and the intuitive one
  // is wrong: a restore writes through `applyChanges({isRevert: true})`, and
  // ancestor normalization is UNCONDITIONAL there — `isRevert` suppresses only the
  // veto. So while the root still declares the field, restoring a descendant is
  // normalized straight back to the stripped schema, and because the key is still in
  // `persistedKeys` the verification sees nothing dropped and reports SUCCESS. The
  // whole mechanism became a no-op that claimed a clean rollback.
  //
  // Once the root no longer owns the field, each descendant restore survives
  // normalization — and the root's own `afterRestorePreImage` cascade is then a
  // no-op, because there is nothing left to strip. Descendants go in cascade order
  // (parents before children) for the same reason: a child's restore normalizes
  // against ancestors that must already be back.
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
