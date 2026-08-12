import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import uniqid from "uniqid";
import {
  assertLandingStillOwned,
  flushPayloadRefreshBuffer,
} from "back-end/src/revisions/landingSequence";
import type { Context } from "back-end/src/models/BaseModel";
import type { DeferredEventBuffer } from "back-end/src/events/bulkPublishCorrelation";
import { entityKey } from "back-end/src/events/bulkPublishCorrelation";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
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
import { ownershipChanged } from "back-end/src/revisions/util";
import { displayEntityName } from "back-end/src/revisions/entityNames";
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
  PlannedItemPublish,
} from "back-end/src/revisions/bulkPublish/types";

export const MAX_BULK_PUBLISH_ITEMS = 50;

function tag(ref: BulkPublishItemRef, gates: PublishGate[]): BulkPublishGate[] {
  return gates.map((gate) => ({
    ...gate,
    entityType: ref.entityType,
    entityId: ref.entityId,
    version: ref.version,
  }));
}

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

// Builds the read-only plan used by both dry-run reporting and commit.
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

  const blockLoad = (gate: BulkPublishGate) => {
    allGates.push(gate);
    blockingGates.push(gate);
  };

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
    // Reject callers with no landing atom before observable guards or hooks.
    // Purity-aware authorization runs in collectGates.
    if (
      (["publish", "revert", "delete"] as const).every(
        (action) =>
          !context.permissions.canRevisionAction(
            ref.entityType,
            action,
            entity as { project?: string; projects?: string[] },
            NO_ENVIRONMENT_BINDING,
          ),
      )
    ) {
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
      // Convert merge conflicts and other 4xx rejections to gates; propagate infrastructure failures.
      if (e instanceof MergeConflictError) {
        blockLoad(itemGate(ref, "merge-conflict", getErrorMessage(e)));
      } else {
        blockLoad(
          gateOr5xx(e, (message) => itemGate(ref, "plan-failed", message)),
        );
      }
    }
  }

  // Validate each item against every other proposal, excluding its own so
  // introduced violations retain a live baseline.
  const overlayContext = getContextForAgendaJobByOrgObject(context.org);
  overlayContext.scanContextOverride = overlayContext;
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

  for (const l of loaded) {
    // Validation overrides require this entity family's org-wide bypass authority.
    const orgWideBypass = context.permissions.canRevisionAction(
      l.ref.entityType,
      "bypass",
      { projects: [] },
    );
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

// Restore cascade parents before descendants so normalization cannot strip them again.
export function restoreOrder(
  applied: PlannedItemPublish[],
): PlannedItemPublish[] {
  const byEntity = new Map(applied.map((i) => [i.ref.entityId, i]));
  const cascadeParents = new Map<PlannedItemPublish, Set<PlannedItemPublish>>();
  for (const item of applied) {
    for (const write of item.revision.cascade ?? []) {
      const target = byEntity.get(write.before.id);
      if (!target || target === item) continue;
      const parents = cascadeParents.get(target) ?? new Set();
      parents.add(item);
      cascadeParents.set(target, parents);
    }
  }
  if (!cascadeParents.size) return [...applied].reverse();

  const ordered: PlannedItemPublish[] = [];
  const done = new Set<PlannedItemPublish>();
  const visiting = new Set<PlannedItemPublish>();
  const visit = (item: PlannedItemPublish) => {
    // A cascade cycle is impossible (lineage is acyclic) but must never hang.
    if (done.has(item) || visiting.has(item)) return;
    visiting.add(item);
    for (const parent of cascadeParents.get(item) ?? []) visit(parent);
    visiting.delete(item);
    done.add(item);
    ordered.push(item);
  };
  for (const item of [...applied].reverse()) visit(item);
  return ordered;
}

// Claim all revisions before writes; on apply failure restore live state before releasing claims.
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

  // Always clear installed context state; buffers detach earlier where ordering matters.
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

    // Buffer effects before no-op replay so compensation can suppress rolled-back events.
    context.sdkPayloadRefreshBuffer = {
      keys: [],
      treatEmptyProjectAsGlobal: false,
    };
    const eventBuffer: DeferredEventBuffer = {
      entries: [],
      restored: new Set<string>(),
    };
    context.bulkPublishDeferredEvents = eventBuffer;
    context.bulkPublishRestoredEntities = eventBuffer.restored;
    // Self-heal writes remain durable on abort, so their effects must still flush.
    const abortWithBuffers = async (
      claimedSoFar: PlannedItemPublish[],
      e: unknown,
    ): Promise<never> => {
      const durable = eventBuffer.entries;
      eventBuffer.closed = true;
      context.bulkPublishDeferredEvents = null;
      context.bulkPublishRestoredEntities = null;
      flushPayloadRefreshBuffer(context, "bulk-publish-abort");
      for (const { emit } of durable) {
        try {
          await emit();
        } catch (emitErr) {
          logger.error(
            emitErr,
            "bulk publish: self-heal event emission failed on abort",
          );
        }
      }
      return abort(claimedSoFar, e) as Promise<never>;
    };

    // Recheck no-op entities after claiming because they have no guarded entity write.
    for (const item of plan.items) {
      if (item.hasChanges) continue;
      const adapter = getBulkAdapter(item.ref.entityType);
      // Even the load stays inside the protected span: a bare infra throw
      // here would leave every revision claimed with the buffers installed.
      let current: unknown;
      try {
        current = await adapter.loadEntity(context, item.ref.entityId);
      } catch (e) {
        await abortWithBuffers(claimed, e);
      }
      const currentDate =
        (current as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
      if (
        (currentDate?.getTime() ?? null) !==
        (item.baseline.entityDateUpdated?.getTime() ?? null)
      ) {
        await abortWithBuffers(claimed, staleConflictError(item.ref));
      }
      // Generic no-ops must retain the newest merge claim; entity timestamps cannot detect it.
      if (item.ref.entityType !== "feature") {
        try {
          await assertLandingStillOwned({
            context,
            entityType: item.ref.entityType,
            entityId: item.ref.entityId,
            mergedId: item.revision.id,
          });
        } catch (e) {
          await abortWithBuffers(claimed, e);
        }
      }
      try {
        await adapter.prepareNoOpMerge?.(
          context,
          item.entityPreImage,
          item.revision,
        );
      } catch (e) {
        await abortWithBuffers(claimed, e);
      }
    }

    // Register before apply so compensation includes partial writes from a failing apply.
    const applied: PlannedItemPublish[] = [];
    // Track cascade stamps so later writes distinguish release-owned from foreign writes.
    const cascadeStamps = new Map<string, Date | null>();
    const stampKey = (item: PlannedItemPublish, id: string) =>
      entityKey(item.ref.entityType, id);
    try {
      for (const item of plan.items) {
        if (!item.hasChanges) continue;
        const adapter = getBulkAdapter(item.ref.entityType);
        // Re-anchor only on this release's cascade stamp; preserve entityPreImage.
        let writeBasis = item.entityPreImage;
        if (cascadeStamps.has(stampKey(item, item.ref.entityId))) {
          const ours =
            cascadeStamps.get(stampKey(item, item.ref.entityId)) ?? null;
          const live = await adapter.loadEntity(context, item.ref.entityId);
          const liveStamp =
            (live as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
          if ((liveStamp?.getTime() ?? null) !== (ours?.getTime() ?? null)) {
            throw staleConflictError(item.ref);
          }
          writeBasis = live as typeof item.entityPreImage;
        }
        applied.push(item);
        await adapter.applyPrecomputed(
          context,
          writeBasis,
          item.revision,
          item.desiredState,
        );

        // Generic claims require a post-write ownership check because newer claims do not touch the entity.
        if (item.ref.entityType !== "feature") {
          await assertLandingStillOwned({
            context,
            entityType: item.ref.entityType,
            entityId: item.ref.entityId,
            mergedId: item.revision.id,
          });
        }
        for (const write of item.revision.cascade ?? []) {
          cascadeStamps.set(
            stampKey(item, write.before.id),
            write.stamp ?? null,
          );
        }
      }
    } catch (e) {
      const applyBuffer = context.sdkPayloadRefreshBuffer;
      // Refreshes use a fresh restore-phase buffer; events retain the original buffer.
      if (applyBuffer) applyBuffer.closed = true;
      context.sdkPayloadRefreshBuffer = {
        keys: [],
        treatEmptyProjectAsGlobal: false,
      };
      const appliedSet = new Set(applied);
      const restoreFailed = new Set<PlannedItemPublish>();
      for (const item of restoreOrder(applied)) {
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
      // Keep claims for entities that could not be restored; classify from restore/reopen outcomes.
      const releaseFailed = await releaseClaims(
        context,
        plan.items.filter((item) => !restoreFailed.has(item)),
      );
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
      // Emit only events whose owning document was not restored, including late entries.
      const survivingEvents = eventBuffer.entries.filter(
        (e) => !eventBuffer.restored.has(e.owner),
      );
      if (
        restoreFailed.size &&
        applyBuffer &&
        context.sdkPayloadRefreshBuffer
      ) {
        context.sdkPayloadRefreshBuffer.keys.push(...applyBuffer.keys);
        context.sdkPayloadRefreshBuffer.treatEmptyProjectAsGlobal ||=
          applyBuffer.treatEmptyProjectAsGlobal;
      }
      eventBuffer.closed = true;
      context.bulkPublishDeferredEvents = null;
      context.bulkPublishRestoredEntities = null;
      flushPayloadRefreshBuffer(context, "bulk-publish-compensation");
      for (const { emit } of survivingEvents) {
        try {
          await emit();
        } catch (emitErr) {
          logger.error(
            emitErr,
            "bulk publish: deferred update-event emission failed for a stuck item",
          );
        }
      }
      const reason = `Release publish failed and was rolled back: ${getErrorMessage(e)}`;
      for (const item of plan.items) {
        // Stuck items receive a distinct reason because they remain published.
        const itemReason = stuckPublished(item)
          ? `Release publish failed and this entity could NOT be rolled back — it remains published and needs reconciling by hand: ${getErrorMessage(e)}`
          : reason;
        try {
          await getBulkAdapter(item.ref.entityType).emitPublishFailed(
            context,
            item.entityPreImage,
            item.revision,
            itemReason,
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

    // End guard suppression, detach buffers, then flush effects for the committed release.
    context.bulkPublishApplying = false;

    const deferredEvents = eventBuffer.entries;
    eventBuffer.closed = true;
    context.bulkPublishDeferredEvents = null;
    context.bulkPublishRestoredEntities = null;
    flushPayloadRefreshBuffer(context, "bulk-publish");

    for (const { emit } of deferredEvents) {
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
    context.bulkPublishDeferredEvents = null;
    context.bulkPublishRestoredEntities = null;
    context.sdkPayloadRefreshBuffer = null;
  }
}

// Returns claimed items that could not be reopened and remain published.
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
