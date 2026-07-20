import { ConfigInterface } from "shared/types/config";
import { ConstantInterface } from "shared/types/constant";
import { FeatureInterface } from "shared/types/feature";
import uniqid from "uniqid";
import type { Context } from "back-end/src/models/BaseModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  BadRequestError,
  ConflictError,
  MergeConflictError,
  getErrorMessage,
} from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import {
  classifyPublishGate,
  PublishGate,
  PublishGateClearance,
} from "back-end/src/revisions/publishGates";
import { getBulkAdapter } from "back-end/src/revisions/bulkPublish/registry";
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

/** Commit-phase failure after claims: carries the honest per-item outcome. */
export class BulkPublishCommitError extends Error {
  status = 500;
  items: BulkPublishItemResult[];
  constructor(message: string, items: BulkPublishItemResult[]) {
    super(message);
    this.name = "BulkPublishCommitError";
    this.items = items;
  }
}

function tag(ref: BulkPublishItemRef, gates: PublishGate[]): BulkPublishGate[] {
  return gates.map((gate) => ({
    ...gate,
    entityType: ref.entityType,
    entityId: ref.entityId,
    version: ref.version,
  }));
}

function itemGate(
  ref: BulkPublishItemRef,
  type: string,
  message: string,
): BulkPublishGate {
  return {
    type,
    severity: "blocker",
    messages: [message],
    override: null,
    requiresPermission: null,
    resolution: null,
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
 * dry-run report and the exact input commitBulkPublish executes — one code
 * path, so a dry run can never disagree with a real run.
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
      blockingGates.push(
        itemGate(
          ref,
          "not-found",
          `${ref.entityType} "${ref.entityId}" not found`,
        ),
      );
      continue;
    }
    const revision = await adapter.loadRevision(context, entity, ref.version);
    if (!revision) {
      blockingGates.push(
        itemGate(
          ref,
          "not-found",
          `Revision v${ref.version} of ${ref.entityType} "${ref.entityId}" not found`,
        ),
      );
      continue;
    }
    if (["merged", "discarded", "published"].includes(revision.status)) {
      blockingGates.push(
        itemGate(
          ref,
          "revision-closed",
          `Revision v${ref.version} of ${ref.entityType} "${ref.entityId}" has status "${revision.status}" and cannot be published`,
        ),
      );
      continue;
    }
    if (!adapter.canPublish(context, entity)) {
      blockingGates.push(
        itemGate(
          ref,
          "permission-denied",
          `You do not have permission to publish ${ref.entityType} "${ref.entityId}"`,
        ),
      );
      continue;
    }
    try {
      const { desiredState, hasChanges, proposedEntity } =
        await adapter.buildDesiredState(context, entity, revision);
      // Project-move laundering guard: the caller needs authority over the
      // post-merge state too, not just the live entity.
      if (!adapter.canUpdate(context, proposedEntity)) {
        blockingGates.push(
          itemGate(
            ref,
            "permission-denied",
            `You do not have permission over the post-publish state of ${ref.entityType} "${ref.entityId}"`,
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
      const gate = itemGate(
        ref,
        e instanceof MergeConflictError ? "merge-conflict" : "plan-failed",
        getErrorMessage(e),
      );
      if (e instanceof MergeConflictError) {
        gate.resolution = {
          action: "rebase",
          method: "POST",
          path: `/${ref.entityType}s/${ref.entityId}/revisions/${ref.version}/rebase`,
        };
      }
      blockingGates.push(gate);
    }
  }

  // The hypothetical end-state: one admin-role scan context whose model reads
  // return the live snapshot with proposed docs substituted. Set as its own
  // scanContextOverride so every guard evaluator reached from it shares the
  // overlay AND its snapshot memos. Saved groups are deliberately not
  // overlaid: no publish-time validator resolves saved-group contents
  // cross-entity.
  //
  // Per-item exclusion: the overlay for item X carries every OTHER item's
  // proposal, never X's own. Validators and guards substitute the entity
  // under evaluation themselves, and the introduced-violation diffs
  // (schema-break et al.) need a baseline WITHOUT X's proposal — overlaying
  // X would make current == proposed and silently blind the diff.
  const overlayContext = getContextForAgendaJobByOrgObject(context.org);
  overlayContext.scanContextOverride = overlayContext;
  const applyOverlaysExcluding = (excluded: Loaded) => {
    const others = loaded.filter((l) => l !== excluded);
    overlayContext.models.configs.setScanOverlay(
      others
        .filter((l) => l.ref.entityType === "config")
        .map((l) => l.proposedEntity as unknown as ConfigInterface),
    );
    overlayContext.models.constants.setScanOverlay(
      others
        .filter((l) => l.ref.entityType === "constant")
        .map((l) => l.proposedEntity as unknown as ConstantInterface),
    );
    overlayContext.featureScanOverlay = new Map(
      others
        .filter((l) => l.ref.entityType === "feature")
        .map((l) => [
          l.ref.entityId,
          l.proposedEntity as unknown as FeatureInterface,
        ]),
    );
  };

  const items: PlannedItemPublish[] = [];

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
        },
      }),
    );

    // Armed (non-locking) sibling schedules deliberately do NOT gate: they
    // behave exactly as under sequential manual publishing — fire-time
    // governance (merge conflicts, arm-fingerprint re-checks, publishFailed)
    // owns that collision. Only scheduledPublishLockOthers siblings block,
    // via the publish-locking gate, matching single-entity semantics.
    const bypassPermission = l.adapter.canBypassApproval(context, l.entity);
    const clearance: PublishGateClearance = {
      ignoreWarnings: flags.ignoreWarnings,
      skipSchemaValidation: flags.skipSchemaValidation && bypassPermission,
      skipHooks: flags.skipHooks && bypassPermission,
      bypassApprovalPermission: bypassPermission,
      restApiBypassesReviews: flags.restApiBypassesReviews,
      canForceMergeStaleBase: bypassPermission,
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
 * COMMIT phase — writes only, no decisions. CAS-claim every revision against its plan-time baseline (any conflict → release all
 * claims, 409, zero entity writes), verify entity drift, apply every
 * precomputed state with side effects buffered, then flush: ONE deduped SDK
 * payload refresh (at most one rebuild per SDK connection) + per-item events.
 * An infra failure mid-apply compensates: restore pre-images, release claims,
 * drop the buffer (no refresh, no webhooks for a rolled-back release).
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

  // Claim all revisions before any live write.
  const claimed: PlannedItemPublish[] = [];
  for (const item of plan.items) {
    const adapter = getBulkAdapter(item.ref.entityType);
    let ok = false;
    try {
      ok = await adapter.claim(context, item.revision, item.baseline, {
        isApprovalBypass: item.isApprovalBypass,
        comment: plan.flags.comment,
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      await releaseClaims(context, claimed);
      context.bulkPublishId = null;
      throw new ConflictError(
        `${item.ref.entityType} "${item.ref.entityId}" changed after the publish was planned — nothing was published; re-plan and retry`,
      );
    }
    claimed.push(item);
  }

  // Entity drift check: claims guard revisions, not entities. Re-read each
  // target and abort (409, zero entity writes) if anything moved since plan.
  for (const item of plan.items) {
    const adapter = getBulkAdapter(item.ref.entityType);
    const current = await adapter.loadEntity(context, item.ref.entityId);
    const currentDate =
      (current as { dateUpdated?: Date } | null)?.dateUpdated ?? null;
    if (
      (currentDate?.getTime() ?? null) !==
      (item.baseline.entityDateUpdated?.getTime() ?? null)
    ) {
      await releaseClaims(context, claimed);
      context.bulkPublishId = null;
      throw new ConflictError(
        `${item.ref.entityType} "${item.ref.entityId}" changed after the publish was planned — nothing was published; re-plan and retry`,
      );
    }
  }

  // Apply, with per-write side effects buffered: SDK payload refreshes
  // (deduped to one flush) and *.updated webhook events (deferred per entity;
  // dropped entirely on compensation).
  context.sdkPayloadRefreshBuffer = {
    keys: [],
    treatEmptyProjectAsGlobal: false,
  };
  context.bulkPublishDeferredEvents = [];
  const applied: PlannedItemPublish[] = [];
  try {
    for (const item of plan.items) {
      if (!item.hasChanges) continue;
      const adapter = getBulkAdapter(item.ref.entityType);
      await adapter.applyPrecomputed(
        context,
        item.entityPreImage,
        item.revision,
        item.desiredState,
      );
      applied.push(item);
    }
  } catch (e) {
    // Compensation: drop the buffered side effects (nothing from the aborted
    // release may reach consumers), restore pre-images in reverse order,
    // release every claim. The restore writes get FRESH buffers: their
    // *.updated events are dropped too (they'd describe an applied→restored
    // transition consumers never saw the first half of), while their payload
    // refreshes flush once, deduped, after the restores — healing any payload
    // a concurrent trigger might have built from the partial state. Only
    // infra failures should reach here (plan validated everything), so the
    // restores are best-effort and the honest per-item outcome rides the error.
    context.sdkPayloadRefreshBuffer = {
      keys: [],
      treatEmptyProjectAsGlobal: false,
    };
    context.bulkPublishDeferredEvents = [];
    const results: BulkPublishItemResult[] = [];
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
        results.push({
          ref: item.ref,
          status: "rolled-back",
          revisionId: item.revision.id,
        });
      } catch (restoreErr) {
        logger.error(
          restoreErr,
          `bulk publish compensation failed to restore ${item.ref.entityType} ${item.ref.entityId}`,
        );
        restoreFailed.add(item);
        results.push({
          ref: item.ref,
          status: "published",
          revisionId: item.revision.id,
        });
      }
    }
    // A restore-failed item's live entity is stuck at the release state, so
    // its revision KEEPS its claim (stays merged/published) — reopening it
    // would make the revision contradict the live doc.
    await releaseClaims(
      context,
      plan.items.filter((item) => !restoreFailed.has(item)),
    );
    for (const item of plan.items) {
      if (!applied.includes(item)) {
        results.push({
          ref: item.ref,
          status: "not-applied",
          revisionId: item.revision.id,
        });
      }
    }
    // Drop the restores' *.updated events; flush their payload refreshes once.
    context.bulkPublishDeferredEvents = null;
    flushPayloadRefreshBuffer(context, "bulk-publish-compensation");
    // A commit failure is the incident-worthy outcome: the release was
    // attempted and rolled back. Notify per revision (best-effort) — plan
    // rejections and claim conflicts never reach here and stay silent.
    const reason = `Release publish failed and was rolled back: ${getErrorMessage(e)}`;
    for (const item of plan.items) {
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
    context.bulkPublishId = null;
    throw new BulkPublishCommitError(
      `Publish failed while applying changes (${getErrorMessage(e)}) — applied entities were rolled back and all revisions reopened`,
      results,
    );
  }

  // Success: flush. Detach the buffers FIRST so the flushes themselves fire,
  // dedupe keys, and issue ONE refresh — refreshSDKPayloadCache rebuilds each
  // affected SDK connection exactly once per call.
  const deferredEvents = context.bulkPublishDeferredEvents ?? [];
  context.bulkPublishDeferredEvents = null;
  flushPayloadRefreshBuffer(context, "bulk-publish");

  // Deferred *.updated webhook events collected during applies — per entity,
  // never deduped, only after the commit is known-good.
  for (const emit of deferredEvents) {
    try {
      await emit();
    } catch (e) {
      logger.error(e, "bulk publish: deferred update-event emission failed");
    }
  }

  // Per-entity deferred side effects (revision events, audit) — per item,
  // never deduped, only after the commit is known-good.
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

  context.bulkPublishId = null;
  return {
    items: plan.items.map((item) => ({
      ref: item.ref,
      status: "published" as const,
      revisionId: item.revision.id,
    })),
    warnings: plan.warnings,
    bulkPublishId,
  };
}

/**
 * Detach the context's payload-refresh buffer and issue ONE deduped refresh —
 * refreshSDKPayloadCache rebuilds each affected SDK connection exactly once
 * per call, so this is what guarantees at most one rebuild per connection per
 * request. Used on the success flush and (with dropped events) after
 * compensation, where refreshing to the restored state heals any payload a
 * concurrent trigger might have built from the partial state.
 */
function flushPayloadRefreshBuffer(context: Context, event: string): void {
  const buffer = context.sdkPayloadRefreshBuffer;
  context.sdkPayloadRefreshBuffer = null;
  if (!buffer || !buffer.keys.length) return;
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

async function releaseClaims(
  context: Context,
  claimed: PlannedItemPublish[],
): Promise<void> {
  for (const item of claimed) {
    try {
      await getBulkAdapter(item.ref.entityType).releaseClaim(
        context,
        item.revision,
      );
    } catch (e) {
      logger.error(
        e,
        `bulk publish: failed to release claim on ${item.ref.entityType} ${item.ref.entityId}`,
      );
    }
  }
}
