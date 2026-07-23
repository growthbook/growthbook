import uniqid from "uniqid";
import type { Context } from "back-end/src/models/BaseModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  BadRequestError,
  BulkPublishCommitError,
  ConflictError,
  MergeConflictError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  classifyPublishGate,
  gateOr5xx,
  makeBlockingGate,
  PublishGate,
  PublishGateClearance,
} from "back-end/src/revisions/publishGates";
import {
  bulkPublishTargetTypes,
  getBulkAdapter,
} from "back-end/src/revisions/bulkPublish/registry";
import type { BulkPublishableAdapter } from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";
import type {
  BulkPublishFlags,
  BulkPublishGate,
  BulkPublishItemRef,
  BulkPublishItemResult,
  BulkPublishPlan,
  BulkPublishResult,
  BulkPublishTargetType,
  PlannedItemPublish,
} from "back-end/src/revisions/bulkPublish/types";

export const MAX_BULK_PUBLISH_ITEMS = 50;

// Whether a merge changes the entity's project ownership (single `project` or
// `projects[]`). Only then does the post-merge state need manage authority on
// the destination — otherwise publishing a same-project revision must not
// require manage (a publish-only role can ship approved drafts).
function ownershipChanged(
  entity: Record<string, unknown>,
  proposedEntity: Record<string, unknown>,
): boolean {
  if (entity.project !== proposedEntity.project) return true;
  const before = entity.projects;
  const after = proposedEntity.projects;
  if (Array.isArray(before) || Array.isArray(after)) {
    const norm = (v: unknown) =>
      JSON.stringify([...((v as string[] | undefined) ?? [])].sort());
    return norm(before) !== norm(after);
  }
  return false;
}

function tag(ref: BulkPublishItemRef, gates: PublishGate[]): BulkPublishGate[] {
  return gates.map((gate) => ({
    ...gate,
    entityType: ref.entityType,
    entityId: ref.entityId,
    version: ref.version,
  }));
}

// User-facing entity noun per the copy glossary: first-class resources are
// Title Case; configs/constants are lowercase common nouns.
function displayEntityName(entityType: BulkPublishTargetType): string {
  switch (entityType) {
    case "feature":
      return "Feature Flag";
    case "saved-group":
      return "Saved Group";
    case "config":
      return "config";
    case "constant":
      return "constant";
    default:
      return entityType;
  }
}

// The caller-facing identifier for messages — never the internal id.
function displayId(ref: BulkPublishItemRef): string {
  return ref.displayId ?? ref.entityId;
}

function staleConflictError(ref: BulkPublishItemRef): ConflictError {
  return new ConflictError(
    `${displayEntityName(ref.entityType)} "${displayId(ref)}" changed after the publish was planned — nothing was published; re-plan and retry`,
  );
}

function itemGate(
  ref: BulkPublishItemRef,
  type: string,
  message: string,
): BulkPublishGate {
  return {
    ...makeBlockingGate({ type, messages: [message] }),
    entityType: ref.entityType,
    entityId: ref.entityId,
    version: ref.version,
  };
}

/**
 * PLAN phase — read-only. Loads every item, builds the hypothetical
 * multi-entity end-state overlay, evaluates every publish gate against it,
 * captures CAS baselines and pre-images, and dispositions each gate against
 * the caller's flags and per-entity authority. The returned plan is both the
 * dry-run report and the exact input commitBulkPublish executes.
 */
export async function planBulkPublish(
  context: Context,
  refs: BulkPublishItemRef[],
  flags: BulkPublishFlags,
): Promise<BulkPublishPlan> {
  if (!refs.length) {
    throw new BadRequestError("No revisions to publish");
  }
  if (refs.length > MAX_BULK_PUBLISH_ITEMS) {
    throw new BadRequestError(
      `Too many revisions: ${refs.length} (max ${MAX_BULK_PUBLISH_ITEMS})`,
    );
  }
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.entityType}:${ref.entityId}`;
    if (seen.has(key)) {
      throw new BadRequestError(
        `Duplicate entity in request: ${key} — one revision per entity`,
      );
    }
    seen.add(key);
  }

  const allGates: BulkPublishGate[] = [];
  const blockingGates: BulkPublishGate[] = [];
  const warnings: string[] = [];

  // Load-phase failures must reach the dryRun report, not just block.
  const blockLoad = (gate: BulkPublishGate) => {
    allGates.push(gate);
    blockingGates.push(gate);
  };

  // Load + merge-compute every item first: the overlay needs every proposed
  // end-state before any validation can run.
  type Loaded = {
    ref: BulkPublishItemRef;
    adapter: BulkPublishableAdapter;
    entity: Record<string, unknown>;
    revision: PlannedItemPublish["revision"];
    desiredState: Record<string, unknown>;
    hasChanges: boolean;
    proposedEntity: Record<string, unknown>;
  };
  const loaded: Loaded[] = [];

  for (const ref of refs) {
    const adapter = getBulkAdapter(ref.entityType);
    const entity = await adapter.loadEntity(context, ref.entityId);
    if (!entity) {
      blockLoad(
        itemGate(
          ref,
          "not-found",
          `${displayEntityName(ref.entityType)} "${displayId(ref)}" not found`,
        ),
      );
      continue;
    }
    const revision = await adapter.loadRevision(context, entity, ref.version);
    if (!revision) {
      blockLoad(
        itemGate(
          ref,
          "not-found",
          `Revision v${ref.version} of ${displayEntityName(ref.entityType)} "${displayId(ref)}" not found`,
        ),
      );
      continue;
    }
    if (["merged", "discarded", "published"].includes(revision.status)) {
      blockLoad(
        itemGate(
          ref,
          "revision-closed",
          `Revision v${ref.version} of ${displayEntityName(ref.entityType)} "${displayId(ref)}" has status "${revision.status}" and cannot be published`,
        ),
      );
      continue;
    }
    if (!adapter.canPublish(context, entity)) {
      blockLoad(
        itemGate(
          ref,
          "permission-denied",
          `You do not have permission to publish ${displayEntityName(ref.entityType)} "${displayId(ref)}"`,
        ),
      );
      continue;
    }
    try {
      const { desiredState, hasChanges, proposedEntity } =
        await adapter.buildDesiredState(context, entity, revision);
      // Project-move laundering guard: only a revision that changes project
      // ownership needs manage authority over the post-merge (destination)
      // state. A same-project publish is gated by publish authority alone.
      if (
        ownershipChanged(entity, proposedEntity) &&
        !adapter.canUpdate(context, proposedEntity)
      ) {
        blockLoad(
          itemGate(
            ref,
            "permission-denied",
            `You do not have permission over the post-publish state of ${displayEntityName(ref.entityType)} "${displayId(ref)}"`,
          ),
        );
        continue;
      }
      loaded.push({
        ref,
        adapter,
        entity,
        revision,
        desiredState,
        hasChanges,
        proposedEntity,
      });
    } catch (e) {
      // Application-level rejections (4xx-classed errors) are the item's
      // problem and become gates; infra failures propagate as the 5xx they
      // are — a transient DB error must not masquerade as an unfixable gate.
      // A merge conflict is always the item's problem (it carries no status).
      if (e instanceof MergeConflictError) {
        blockLoad(itemGate(ref, "merge-conflict", getErrorMessage(e)));
      } else {
        blockLoad(
          gateOr5xx(e, (message) => itemGate(ref, "plan-failed", message)),
        );
      }
    }
  }

  // The hypothetical end-state: an admin-role scan context whose model reads
  // return the live snapshot with proposed docs substituted (set as its own
  // scanContextOverride so every guard evaluator shares the overlay and its
  // memos). Per-item exclusion: item X's overlay carries every OTHER item's
  // proposal, never its own — evaluators substitute X themselves, and the
  // introduced-violation diffs need a live baseline for X.
  const overlayContext = getContextForAgendaJobByOrgObject(context.org);
  overlayContext.scanContextOverride = overlayContext;
  // Install every type's slice of the end-state overlay via its adapter — each
  // item is validated with every OTHER item's proposal in place and its own
  // excluded (evaluators substitute the item under test themselves and need a
  // live baseline for it). Looping the full registry (empty slices clear)
  // keeps this free of per-type branches; a new bulk type gets overlaid the
  // moment it registers.
  const applyOverlaysExcluding = (excluded: Loaded) => {
    const others = loaded.filter((l) => l !== excluded);
    for (const type of bulkPublishTargetTypes) {
      getBulkAdapter(type).applyScanOverlay(
        overlayContext as Context,
        others
          .filter((l) => l.ref.entityType === type)
          .map((l) => l.proposedEntity),
      );
    }
  };

  const items: PlannedItemPublish[] = [];

  // The privileged validation overrides require ORG-WIDE bypass authority (the
  // scope the single-entity paths enforce via the context's skipSchemaValidation
  // /skipHooks getters). A project-scoped bypass clears approval (per entity,
  // below) but never a validation failure.
  const orgWideBypass = context.permissions.canBypassApprovalChecks({
    project: undefined,
  });

  for (const l of loaded) {
    applyOverlaysExcluding(l);
    const gates = tag(
      l.ref,
      await l.adapter.collectGates({
        callerContext: context,
        overlayContext: overlayContext as Context,
        entity: l.entity,
        revision: l.revision,
        desiredState: l.desiredState,
        flags: {
          skipSchemaValidation: flags.skipSchemaValidation,
          skipHooks: flags.skipHooks,
          comment: flags.comment,
        },
      }),
    );

    // Armed (non-locking) sibling schedules deliberately do NOT gate — they
    // behave as under sequential manual publishing, where fire-time
    // governance owns that collision. Only lock-others siblings block.
    const bypassPermission = l.adapter.canBypassApproval(context, l.entity);
    const clearance: PublishGateClearance = {
      ignoreWarnings: flags.ignoreWarnings,
      skipSchemaValidation: flags.skipSchemaValidation && orgWideBypass,
      skipHooks: flags.skipHooks && orgWideBypass,
      bypassApprovalPermission: bypassPermission,
      restApiBypassesReviews: flags.restApiBypassesReviews,
      canForceMergeStaleBase:
        bypassPermission ||
        (l.adapter.staleBaseForceAllowsRestBypass &&
          flags.restApiBypassesReviews),
    };

    const bypassedGates: PlannedItemPublish["bypassedGates"] = [];
    let approvalBypassed = false;
    let itemBlocked = false;
    for (const gate of gates) {
      allGates.push(gate);
      const disposition = classifyPublishGate(gate, clearance);
      if (disposition.outcome === "blocking") {
        blockingGates.push(gate);
        itemBlocked = true;
      } else {
        bypassedGates.push({
          type: gate.type,
          outcome: "bypassed",
          via: disposition.via,
        });
        if (gate.severity === "warning") warnings.push(...gate.messages);
        if (gate.type === "approval-required") approvalBypassed = true;
      }
    }
    if (itemBlocked) continue;

    items.push({
      ref: l.ref,
      entityPreImage: l.entity,
      revision: l.revision,
      desiredState: l.desiredState,
      proposedEntity: l.proposedEntity,
      hasChanges: l.hasChanges,
      baseline: {
        revisionStatus: l.revision.status,
        revisionDateUpdated: l.revision.dateUpdated,
        entityDateUpdated:
          (l.entity as { dateUpdated?: Date }).dateUpdated ?? null,
      },
      isApprovalBypass: approvalBypassed,
      bypassedGates,
    });
  }

  return { items, gates: allGates, blockingGates, warnings, flags };
}

/**
 * COMMIT phase — writes only, no decisions. Verify entity drift, CAS-claim
 * every revision against its plan-time baseline (any conflict → release all
 * claims, 409, zero entity writes), apply every precomputed state with side
 * effects buffered, then flush: ONE deduped SDK payload refresh + per-item
 * events. An infra failure mid-apply compensates: restore pre-images, release
 * claims, drop the buffer (no refresh, no webhooks for a rolled-back release).
 */
export async function commitBulkPublish(
  context: Context,
  plan: BulkPublishPlan,
): Promise<BulkPublishResult> {
  if (plan.blockingGates.length) {
    throw new BadRequestError(
      "Cannot commit a plan with blocking gates — re-plan and resolve them",
    );
  }

  // Correlation token stamped on every event this publish emits (success and
  // failure alike) and returned to the caller for joining response ↔ webhooks.
  const bulkPublishId = uniqid("pub_");
  context.bulkPublishId = bulkPublishId;
  // Durable breadcrumb BEFORE the first claim: a crash mid-commit leaves the
  // batch's revisions claimed with no in-process compensation, and this line
  // is the only artifact naming them (recovery: revert-to-revision).
  logger.info(
    {
      bulkPublishId,
      org: context.org.id,
      items: plan.items.map(
        (i) => `${i.ref.entityType}:${i.ref.entityId}@v${i.ref.version}`,
      ),
    },
    "bulk publish: committing release",
  );

  // Pre-apply bailout (entity drift, or a lost claim CAS): release whatever we
  // claimed and rethrow the original conflict as a clean retryable 409. But if
  // a reopen ITSELF fails, that revision is stuck merged while its entity was
  // never written — so surface it like the compensation path (500 with per-item
  // results: stuck revisions "published", the rest "not-applied") not the 409.
  const abort = async (claimed: PlannedItemPublish[], e: unknown) => {
    const releaseFailed = await releaseClaims(context, claimed);
    if (releaseFailed.size) {
      throw new BulkPublishCommitError(
        `Publish aborted (${getErrorMessage(e)}) — ${releaseFailed.size} of ${plan.items.length} revision(s) could not be reopened and remain published (see items); no entities were changed`,
        plan.items.map((item) => ({
          ref: item.ref,
          revisionId: item.revision.id,
          status: releaseFailed.has(item)
            ? ("published" as const)
            : ("not-applied" as const),
        })),
      );
    }
    throw e;
  };

  // The finally clears both the correlation token AND the guard-suppression
  // flag on every exit (success, 409/500 throw, or a raw infra throw).
  try {
    // Entity drift check FIRST: claims guard revisions, not entities. Re-read
    // each target and abort (zero writes) if anything moved since plan. Before
    // the no-op replays, whose self-heal writes can bump a sibling's dateUpdated.
    for (const item of plan.items) {
      const adapter = getBulkAdapter(item.ref.entityType);
      const current = await adapter.loadEntity(context, item.ref.entityId);
      const currentDate =
        (current as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
      if (
        (currentDate?.getTime() ?? null) !==
        (item.baseline.entityDateUpdated?.getTime() ?? null)
      ) {
        await abort([], staleConflictError(item.ref));
      }
    }

    // Writes begin here (no-op self-heal reconcile onward): suppress the
    // plan-gated write-path guards so they don't re-judge the mid-commit mix.
    context.bulkPublishApplying = true;

    // No-op items skip applyPrecomputed, so side effects an earlier partial
    // apply may have left unrun (e.g. a descendant schema cascade) are replayed
    // here — BEFORE any claim, so a failure leaves every draft open.
    for (const item of plan.items) {
      if (item.hasChanges) continue;
      await getBulkAdapter(item.ref.entityType).prepareNoOpMerge?.(
        context,
        item.entityPreImage,
        item.revision,
      );
    }

    // Claim all revisions before any live write. A lost CAS race is a 409; any
    // other claim failure is an infra error and propagates as such — after
    // releasing whatever was already claimed.
    const claimed: PlannedItemPublish[] = [];
    for (const item of plan.items) {
      const adapter = getBulkAdapter(item.ref.entityType);
      let ok = false;
      try {
        ok = await adapter.claim(context, item.revision, item.baseline, {
          isApprovalBypass: item.isApprovalBypass,
          comment: plan.flags.comment,
        });
      } catch (e) {
        logger.error(
          e,
          `bulk publish: claim failed for ${item.ref.entityType} ${item.ref.entityId}`,
        );
        await abort(claimed, e);
      }
      if (!ok) {
        await abort(claimed, staleConflictError(item.ref));
      }
      claimed.push(item);
    }

    // Apply, with per-write side effects buffered: SDK payload refreshes
    // (deduped to one flush) and *.updated webhook events (deferred per entity;
    // dropped entirely on compensation).
    context.sdkPayloadRefreshBuffer = {
      keys: [],
      treatEmptyProjectAsGlobal: false,
    };
    context.bulkPublishDeferredEvents = [];
    // Every item joins `applied` BEFORE its apply runs: a multi-step apply
    // (ramp creates → entity write → holdout) can land real writes before
    // throwing, so compensation must restore the failing item too.
    const applied: PlannedItemPublish[] = [];
    try {
      for (const item of plan.items) {
        if (!item.hasChanges) continue;
        const adapter = getBulkAdapter(item.ref.entityType);
        applied.push(item);
        await adapter.applyPrecomputed(
          context,
          item.entityPreImage,
          item.revision,
          item.desiredState,
        );
      }
    } catch (e) {
      // Compensation: drop the buffered side effects (nothing from the aborted
      // release may reach consumers), restore pre-images in reverse order,
      // release every claim. Restore writes get fresh buffers — their *.updated
      // events are dropped too, while their payload refreshes flush once after
      // the restores, healing any payload built from the partial state.
      const applyBuffer = context.sdkPayloadRefreshBuffer;
      // Close the apply-phase buffer so straggler producers still holding its
      // reference fall through to live refreshes instead of a drained array.
      if (applyBuffer) applyBuffer.closed = true;
      context.sdkPayloadRefreshBuffer = {
        keys: [],
        treatEmptyProjectAsGlobal: false,
      };
      context.bulkPublishDeferredEvents = [];
      const appliedSet = new Set(applied);
      const restoreFailed = new Set<PlannedItemPublish>();
      for (const item of [...applied].reverse()) {
        const adapter = getBulkAdapter(item.ref.entityType);
        try {
          await adapter.restorePreImage(
            context,
            item.entityPreImage,
            item.revision,
            item.desiredState,
          );
        } catch (restoreErr) {
          logger.error(
            restoreErr,
            `bulk publish compensation failed to restore ${item.ref.entityType} ${item.ref.entityId}`,
          );
          restoreFailed.add(item);
        }
      }
      // A restore-failed item's live entity is stuck at the release state, so
      // its revision KEEPS its claim — reopening it would make the revision
      // contradict the live doc. A reopen that FAILS for any other item leaves
      // its revision stuck published too, so it joins the "published" bucket.
      const releaseFailed = await releaseClaims(
        context,
        plan.items.filter((item) => !restoreFailed.has(item)),
      );
      // "published" = revision stays merged (entity stuck published, or entity
      // restored but the reopen failed); "rolled-back" = entity restored AND
      // revision reopened; "not-applied" = never touched, reopened cleanly.
      const stuckPublished = (item: PlannedItemPublish) =>
        restoreFailed.has(item) || releaseFailed.has(item);
      const results: BulkPublishItemResult[] = plan.items.map((item) => ({
        ref: item.ref,
        revisionId: item.revision.id,
        status: stuckPublished(item)
          ? ("published" as const)
          : appliedSet.has(item)
            ? ("rolled-back" as const)
            : ("not-applied" as const),
      }));
      // A restore-failed item stays durably published, so its apply-phase
      // refresh keys must still flush or SDK payloads serve the pre-publish
      // state indefinitely. Restored items' extra keys are harmless (the
      // refresh rebuilds from live state and dedupes per connection).
      if (
        restoreFailed.size &&
        applyBuffer &&
        context.sdkPayloadRefreshBuffer
      ) {
        context.sdkPayloadRefreshBuffer.keys.push(...applyBuffer.keys);
        context.sdkPayloadRefreshBuffer.treatEmptyProjectAsGlobal ||=
          applyBuffer.treatEmptyProjectAsGlobal;
      }
      // Drop the restores' *.updated events; flush their payload refreshes once.
      context.bulkPublishDeferredEvents = null;
      flushPayloadRefreshBuffer(context, "bulk-publish-compensation");
      // A commit failure is the incident-worthy outcome: the release was
      // attempted and rolled back. Notify per revision (best-effort) — plan
      // rejections and claim conflicts never reach here and stay silent.
      const reason = `Release publish failed and was rolled back: ${getErrorMessage(e)}`;
      for (const item of plan.items) {
        // An item whose revision stays merged must NOT get a "rolled back"
        // event — its `status: "published"` result row is the signal instead.
        // KNOWN LIMITATION: stuck items therefore emit no event at all (running
        // the success chain mid-compensation would fire normal-success signals
        // on a needs-attention state). A dedicated stuck/needs-attention event
        // is deliberately deferred: it's new public webhook semantics, designed
        // alongside the uniform publish-failure webhook work.
        if (stuckPublished(item)) continue;
        try {
          await getBulkAdapter(item.ref.entityType).emitPublishFailed(
            context,
            item.entityPreImage,
            item.revision,
            reason,
          );
        } catch (emitErr) {
          logger.error(
            emitErr,
            `bulk publish: publishFailed emission failed for ${item.ref.entityType} ${item.ref.entityId}`,
          );
        }
      }
      const stuckCount = restoreFailed.size + releaseFailed.size;
      throw new BulkPublishCommitError(
        stuckCount
          ? `Publish failed while applying changes (${getErrorMessage(e)}) — ${stuckCount} of ${plan.items.length} entities could not be fully rolled back and remain published (see items)`
          : `Publish failed while applying changes (${getErrorMessage(e)}) — applied entities were rolled back and all revisions reopened`,
        results,
      );
    }

    // Commit succeeded: guard suppression ends so post-commit side-effect writes
    // (ramp activation etc. — genuine writes NOT covered by plan gates) run with
    // validation active. The correlation token stays set for the events below.
    context.bulkPublishApplying = false;

    // Success: detach the buffers FIRST so the flushes themselves fire, then
    // emit everything deferred — only after the commit is known-good.
    const deferredEvents = context.bulkPublishDeferredEvents ?? [];
    context.bulkPublishDeferredEvents = null;
    flushPayloadRefreshBuffer(context, "bulk-publish");

    for (const emit of deferredEvents) {
      try {
        await emit();
      } catch (e) {
        logger.error(e, "bulk publish: deferred update-event emission failed");
      }
    }

    for (const item of plan.items) {
      const adapter = getBulkAdapter(item.ref.entityType);
      try {
        await adapter.emitPublished(
          context,
          item.entityPreImage,
          item.revision,
          item.desiredState,
        );
      } catch (e) {
        logger.error(
          e,
          `bulk publish: post-commit event emission failed for ${item.ref.entityType} ${item.ref.entityId}`,
        );
      }
    }

    return {
      items: plan.items.map((item) => ({
        ref: item.ref,
        status: "published" as const,
        revisionId: item.revision.id,
      })),
      warnings: plan.warnings,
      bulkPublishId,
    };
  } finally {
    context.bulkPublishId = null;
    context.bulkPublishApplying = false;
  }
}

/**
 * Detach the context's payload-refresh buffer and issue ONE deduped refresh —
 * refreshSDKPayloadCache rebuilds each affected SDK connection once per call,
 * which is what guarantees at most one rebuild per connection per request.
 */
function flushPayloadRefreshBuffer(context: Context, event: string): void {
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

// Reopen each claimed revision. Returns the items whose reopen FAILED — their
// revision stays merged/published, so compensation must report them "published"
// (not "rolled-back") even when their entity restored cleanly.
async function releaseClaims(
  context: Context,
  claimed: PlannedItemPublish[],
): Promise<Set<PlannedItemPublish>> {
  const failed = new Set<PlannedItemPublish>();
  for (const item of claimed) {
    try {
      const reopened = await getBulkAdapter(item.ref.entityType).releaseClaim(
        context,
        item.revision,
      );
      // A no-op reopen (the claim fingerprint no longer matches — a concurrent
      // publish owns the revision) leaves it merged/published, same as a throw:
      // the item is stuck-published, not cleanly rolled back.
      if (!reopened) failed.add(item);
    } catch (e) {
      failed.add(item);
      logger.error(
        e,
        `bulk publish: failed to release claim on ${item.ref.entityType} ${item.ref.entityId}`,
      );
    }
  }
  return failed;
}
