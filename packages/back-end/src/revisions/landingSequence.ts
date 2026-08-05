import { isEqual } from "lodash";
import type { RevisionTargetType } from "shared/enterprise";
import { getAdapter } from "back-end/src/revisions";
import { Context } from "back-end/src/models/BaseModel";
import { ConflictError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { displayEntityName } from "back-end/src/revisions/entityNames";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import { applyVerifiedRestore } from "back-end/src/revisions/bulkPublish/verifiedRestore";

// The write sequencing every landing shares, extracted from the bulk pipeline so
// the single-entity paths get the same discipline: check the baseline the change
// was computed from before writing, and put the live entity back when the write
// fails partway.
//
// Without it a direct landing is read-compute-write with no guard, so two of them
// can apply in either order and leave live state contradicting the newest merged
// revision. These are optimistic (application-level) checks, matching the rest of
// the codebase — no transactions, so DocumentDB/CosmosDB stay supported.
//
// Cost: one extra indexed entity read before recording history, plus a read and a
// latest-merged lookup before the write. The pre-flight read is deliberate rather
// than folded into the second check — a doomed landing that never becomes history
// cannot leave phantom history behind if its removal then fails.

/** A landing lost its race. Retryable: nothing was written. */
function landingConflictError(
  entityType: RevisionTargetType,
  entityId: string,
): ConflictError {
  return new ConflictError(
    `${displayEntityName(entityType)} "${entityId}" changed while this was being applied — nothing was written; retry`,
  );
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
  /**
   * When set, this revision must still be the newest merged one for the target.
   * A newer merge means another landing already recorded intent that supersedes
   * this one, so applying would overwrite it with older state.
   */
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
    if (latest && latest.id !== requireLatestMergedId) {
      throw landingConflictError(entityType, entityId);
    }
  }
}

/**
 * Put back the fields a failed write persisted, so a partial apply doesn't leave
 * an unrecorded live change behind.
 *
 * The same rule the bulk pipeline compensates with, and the same helpers: restore
 * a key only while live still holds the value this apply wrote, then verify every
 * restored key actually landed. Value-based, so it can't catch a concurrent writer
 * that set a key to the same value — that residual is the entity-write lost-update
 * window, closed only by CAS-guarding the apply itself.
 *
 * Throws when the restore can't be completed. Callers treat that as "live is left
 * mid-change" and keep the merged revision, since a recorded partial change can be
 * reconciled by hand and an unrecorded one cannot.
 */
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
  /**
   * The keys to consider putting back. Callers pass what the apply reported
   * persisting, or the intended changes when it threw before reporting — the
   * value check below makes the difference harmless, since a key the apply never
   * wrote restores to itself.
   */
  persistedKeys: Iterable<string>;
  /** The values the apply intended to write, for the "do we still own it" test. */
  written: Record<string, unknown>;
}): Promise<void> {
  const adapter = getAdapter(entityType);
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
  await applyVerifiedRestore({
    restore,
    current: current as Record<string, unknown>,
    label: `${entityType} "${preImage.id}"`,
    // A pre-image is a state that was already live, so the restore is a revert:
    // skip the validations that exist to judge new intent.
    write: (values) =>
      adapter.applyChanges(context, current, values, { isRevert: true }),
  });
}

/**
 * Whether the live entity still holds exactly what a set of changes intended,
 * i.e. the write landed. Used to decide whether a landing that raced can report
 * success instead of asking the caller to retry.
 */
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
