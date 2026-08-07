import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import uniqid from "uniqid";
import { flushPayloadRefreshBuffer } from "back-end/src/revisions/landingSequence";
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

// PLAN phase — read-only. Loads every item, builds the hypothetical
// multi-entity end-state overlay, evaluates every publish gate against it,
// captures CAS baselines and pre-images, and dispositions each gate against
// the caller's flags and per-entity authority. The returned plan is both the
// dry-run report and the exact input commitBulkPublish executes.
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
    // Coarse authority, before anything expensive or observable. Refusing on
    // `canPublish` alone was wrong — a pure revert or pure archive is landable on
    // the narrower revert/delete atoms, which can only be judged once the
    // revision's changes are known — but refusing on NONE of the three landing
    // atoms is safe: no footprint or purity path can rescue a caller who holds
    // none of them in this project. Subset-refusing, so revert-only and
    // delete-only callers still reach the purity-aware check in `collectGates`.
    //
    // This has to stay here rather than only in `collectGates`, which pushes the
    // permission gate and then keeps collecting: entity guards, schema
    // validation and the org's sandboxed Custom Hooks all run after it. Without
    // this an unauthorized caller executes that hook code and reads the whole
    // governance-gate enumeration on the way to their refusal. Mirrors
    // postFeatureRevisionPublish.
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
      // A project move additionally requires manage on the destination.
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

  for (const l of loaded) {
    // The privileged validation overrides require ORG-WIDE bypass authority (the
    // scope the single-entity paths enforce via the context's skipSchemaValidation
    // /skipHooks getters). A project-scoped bypass clears approval (per entity,
    // below) but never a validation failure. Resolved per item, because bypass is
    // per family now — flags authority must not clear a Saved Group's validation.
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

// Reverse apply order, except that an item whose cascade rewrote ANOTHER item's
// entity is restored before that item. Ancestor normalization is unconditional on a
// revert, so a descendant Config restored while its parent still declares a field is
// re-stripped — and reports success, because the key was still persisted. Same
// root-first rule the single-revision compensation follows.
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

// COMMIT phase — writes only, no decisions. Verify entity drift, CAS-claim
// every revision against its plan-time baseline (any conflict → release all
// claims, 409, zero entity writes), apply every precomputed state with side
// effects buffered, then flush: ONE deduped SDK payload refresh + per-item
// events. An infra failure mid-apply compensates: restore pre-images, release
// claims, drop the buffer (no refresh, no webhooks for a rolled-back release).
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

  // The finally clears every context field this commit installs, on every exit
  // (success, 409/500 throw, or a raw infra throw). The terminals below clear the
  // buffers earlier where ordering matters — the event clear has to precede the emit
  // loop, or a write during that loop inherits the finished release's verdict — and
  // this is the backstop for a throw that escapes them all. An OPEN buffer surviving
  // here is the worst of the failure modes: capture hands it out happily, every later
  // event is pushed into something nobody will flush, and the leaked refresh buffer
  // stops the next landing installing its own to recover.
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

    // Side-effect buffering starts HERE, before the no-op self-heal replays:
    // their descendant writes fire refreshes and events too, and unbuffered
    // they leaked out of a release that then aborted. SDK payload refreshes are
    // deduped to one flush; *.updated events are deferred per entity and
    // dropped entirely on compensation.
    context.sdkPayloadRefreshBuffer = {
      keys: [],
      treatEmptyProjectAsGlobal: false,
    };
    const eventBuffer: DeferredEventBuffer = {
      entries: [],
      restored: new Set<string>(),
    };
    context.bulkPublishDeferredEvents = eventBuffer;
    // Restores report into the buffer's own set, so it survives alongside the closed
    // buffer and a late producer can consult it.
    context.bulkPublishRestoredEntities = eventBuffer.restored;
    // An abort past this point carries buffered effects: the replay's writes are REAL
    // live writes, so their refreshes flush (a refresh rebuilds from live state and is
    // correct whatever aborted) — and so do their EVENTS, for the same reason. Nothing
    // published, but the self-heal writes are durable and nothing will restore them.
    const abortWithBuffers = async (
      claimedSoFar: PlannedItemPublish[],
      e: unknown,
    ): Promise<never> => {
      // Nothing has been applied, so nothing is in `restored` and every entry is a
      // self-heal replay's — real live writes no compensation undoes. A late one takes
      // the same answer from the same set, through the reference it captured.
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

    // No-op items never perform a guarded entity write, so nothing later would
    // catch drift for them — re-verify their baselines now that every claim is
    // held. Items WITH changes are covered by the guard at their write. Without
    // this, a change landing between the pre-claim drift check and the claims
    // leaves a no-op revision merged while claiming a live state that no longer
    // exists.
    for (const item of plan.items) {
      if (item.hasChanges) continue;
      const adapter = getBulkAdapter(item.ref.entityType);
      // Inside the protected span like everything else here: a bare throw from
      // the load itself (infra) escaped past the claims, leaving every revision
      // merged with no entity writes and the buffers still installed.
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
      // The no-op self-heal replay (e.g. a descendant schema cascade an earlier
      // partial apply left unrun) runs INSIDE the protected span, after this
      // item's claim and baseline both hold — run before the claims, its writes
      // survived a claim failure that then reopened every draft. Same ordering
      // as the single-revision engine; a failure releases all claims.
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

    // Every item joins `applied` BEFORE its apply runs: a multi-step apply
    // (ramp creates → entity write → holdout) can land real writes before
    // throwing, so compensation must restore the failing item too.
    const applied: PlannedItemPublish[] = [];
    // Entities an earlier item's descendant cascade rewrote, and the stamp it left:
    // publishing a parent Config and its child in one release moves the child's
    // `dateUpdated` before the child's own guarded write, whose CAS is anchored on the
    // plan-time pre-image. The release then succeeded or 409'd purely on item order.
    const cascadeStamps = new Map<string, Date | null>();
    // Keyed by TYPE and id: a cascade writes documents of the item's own type, but the
    // map is consulted by every item, and bare ids collide across collections.
    const stampKey = (item: PlannedItemPublish, id: string) =>
      entityKey(item.ref.entityType, id);
    try {
      for (const item of plan.items) {
        if (!item.hasChanges) continue;
        const adapter = getBulkAdapter(item.ref.entityType);
        // Re-anchor on the doc OUR OWN cascade left, and only that one — any other
        // stamp is a foreign write and must still conflict. `entityPreImage` is
        // untouched, so compensation still restores the pre-release state.
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
        for (const write of item.revision.cascade ?? []) {
          cascadeStamps.set(
            stampKey(item, write.before.id),
            write.stamp ?? null,
          );
        }
      }
    } catch (e) {
      // Compensation: drop the buffered side effects (nothing from the aborted
      // release may reach consumers), restore pre-images in reverse order,
      // release every claim. Restore writes get fresh buffers — their *.updated
      // events are dropped too, while their payload refreshes flush once after
      // the restores, healing any payload built from the partial state.
      const applyBuffer = context.sdkPayloadRefreshBuffer;
      // Refreshes get a fresh buffer for the restore phase; the old one is closed so
      // straggler producers fall through to a live refresh, which rebuilds from live
      // state and is right whatever happened.
      if (applyBuffer) applyBuffer.closed = true;
      context.sdkPayloadRefreshBuffer = {
        keys: [],
        treatEmptyProjectAsGlobal: false,
      };
      // EVENTS keep the SAME buffer across the restore phase. A separate one had to
      // guess in both directions and got both wrong: an apply-phase straggler resuming
      // during the restores landed in it and was dropped even when its entity stayed
      // durably published, and a restore's own event needed dropping regardless. One
      // buffer plus the per-document rule below decides all of them the same way — an
      // event is emitted only if its document was not put back, which excludes every
      // restore write (its document is, by definition, restored).
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
      // An item whose restore failed is durably published, so the `*.updated` events
      // its apply produced describe live state and must still fire. Everything else
      // rolled back, and an event for a change that no longer exists is worse than
      // none. Ownership comes from the apply loop's stamp, so a cascade write made on
      // an item's behalf travels with that item.
      // Emit an event exactly when its DOCUMENT was not put back. That covers the
      // three durable cases with one rule — an item whose restore failed, a document
      // the feature adapter left whole, and a self-heal replay's write that no item
      // owns — and excludes the case an item-level flag could not: a Config root that
      // WAS restored while a descendant of the same item was not, whose event would
      // otherwise assert the published value over live pre-publish state.
      // Read AFTER the restores, so entries a straggler added mid-rollback are judged
      // by the same rule rather than silently discarded with a separate buffer.
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
      // Closed, with its `restored` set intact — a producer holding a reference to it
      // is judged by that set, whenever it resumes.
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
      // A commit failure is the incident-worthy outcome: the release was
      // attempted and rolled back. Notify per revision (best-effort) — plan
      // rejections and claim conflicts never reach here and stay silent.
      const reason = `Release publish failed and was rolled back: ${getErrorMessage(e)}`;
      for (const item of plan.items) {
        // A stuck item must NOT get the plain "rolled back" reason — its state is
        // the opposite, and its `status: "published"` result row says so. But it
        // emitted NOTHING at all, which made the one incident-worthy outcome the
        // only silent one while its cleanly-reverted neighbours each notified. The
        // reason is free text, so the distinction rides there rather than needing a
        // new event type — and the single-entity path already re-emits for exactly
        // this situation, so the two publish surfaces now agree.
        //
        // A dedicated stuck/needs-attention event is still the right end state
        // (new public webhook semantics, designed with the uniform publish-failure
        // work); this stops the silence in the meantime.
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

    // Commit succeeded: guard suppression ends so post-commit side-effect writes
    // (ramp activation etc. — genuine writes NOT covered by plan gates) run with
    // validation active. The correlation token stays set for the events below.
    context.bulkPublishApplying = false;

    // Success: detach the buffers FIRST so the flushes themselves fire, then
    // emit everything deferred — only after the commit is known-good.
    const deferredEvents = eventBuffer.entries;
    // The release stands, so nothing is in `restored` and every straggler emits.
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
