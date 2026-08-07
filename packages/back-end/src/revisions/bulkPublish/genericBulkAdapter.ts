import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  holdsMoveDestination,
  type ProjectScoped,
} from "back-end/src/revisions/moveAuthority";
import { canPublishRevisionChange } from "back-end/src/revisions/revisionActions";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import type { Context } from "back-end/src/models/BaseModel";
import {
  type EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  authorityRefused,
  makeBlockingGate,
  type PublishGate,
} from "back-end/src/revisions/publishGates";
import { isArchiveTransition } from "back-end/src/revisions/archiveTransition";
import { displayEntityName } from "back-end/src/revisions/entityNames";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import {
  restoreEntityPreImage,
  runGuardedWrite,
} from "back-end/src/revisions/landingSequence";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { ConflictError, MergeConflictError } from "back-end/src/util/errors";
import type {
  BulkPublishableAdapter,
  BulkRevisionRef,
} from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

function toRef(revision: Revision): BulkRevisionRef {
  return {
    id: revision.id,
    version: revision.version ?? 0,
    status: revision.status,
    dateUpdated: revision.dateUpdated,
    raw: revision,
  };
}

// Bulk-publish surface for any entity on the generic revision system. Wraps
// the entity's EntityRevisionAdapter for entity behavior and the shared
// RevisionModel for revision lifecycle. `extraGates` lets a type contribute
// gates its single-entity REST handler assembles inline (e.g. the config
// lock gate) without the orchestrator knowing the type.
export function makeGenericBulkAdapter(
  targetType: RevisionTargetType,
  adapter: EntityRevisionAdapter,
  options: {
    extraGates?: (args: {
      callerContext: Context;
      overlayContext: Context;
      entity: Record<string, unknown>;
      revision: Revision;
      desiredState: Record<string, unknown>;
    }) => Promise<PublishGate[]>;
    // Install this type's proposed docs on the overlay context — wired per type
    // in the registry, since each model's setScanOverlay is strongly typed.
    setScanOverlay: (
      overlayContext: Context,
      proposedEntities: Record<string, unknown>[],
    ) => void;
  },
): BulkPublishableAdapter {
  return {
    staleBaseForceAllowsRestBypass: true,

    applyScanOverlay(overlayContext, proposedEntities) {
      options.setScanOverlay(overlayContext, proposedEntities);
    },

    async loadEntity(context, entityId) {
      const model = adapter.getModel(context);
      if (!model) return null;
      return (await model.getById(entityId)) ?? null;
    },

    async loadRevision(context, entity, version) {
      const revision = await context.models.revisions.getByTargetAndVersion(
        targetType,
        (entity as { id: string }).id,
        version,
      );
      return revision ? toRef(revision) : null;
    },

    canUpdate(context, entity) {
      return adapter.canUpdate(context, entity);
    },

    canBypassApproval(context, entity) {
      return adapter.canBypassApproval(context, entity);
    },

    async buildDesiredState(context, entity, revision) {
      const raw = revision.raw as Revision;
      const snapshot = raw.target.snapshot as Record<string, unknown>;
      const updatable = adapter.getUpdatableFields();
      const conflictResult = checkMergeConflicts(
        snapshot,
        entity,
        normalizeProposedChanges(raw.target.proposedChanges),
        updatable,
      );
      if (!conflictResult.success) {
        throw new MergeConflictError(
          "Merge conflicts exist — rebase before publishing",
          conflictResult.conflicts,
        );
      }
      const desiredState = buildMergeDesiredState(
        entity,
        snapshot,
        raw.target.proposedChanges,
        updatable,
      );
      // Exactly what applyChanges will write — same filter, so hasChanges can
      // never disagree with the apply about whether there's a net change.
      const hasChanges =
        Object.keys(filterUpdatableChanges(desiredState, entity, updatable))
          .length > 0;
      return {
        desiredState,
        hasChanges,
        proposedEntity: { ...entity, ...desiredState },
      };
    },

    async collectGates({
      callerContext,
      overlayContext,
      entity,
      revision,
      desiredState,
    }) {
      const raw = revision.raw as Revision;
      // Approval + stale-base via the shared collector (approval scoping
      // stays inside each adapter's isApprovalRequiredForRevision). Caller
      // context: governance judges the caller's org policy, not the overlay
      // end-state.
      const gates: PublishGate[] = collectRevisionGovernanceGates({
        context: callerContext,
        adapter,
        targetType,
        entity,
        revision: raw,
      });

      // The load-time gate is coarse — it takes only the entity, so it cannot see
      // which environments this change reaches, and a caller limited to dev
      // cleared it while landing a production override. This is the
      // authoritative check: the same assertion the single-revision engine
      // makes, which layers the change-aware footprint and the purity fallbacks
      // on top. The archive gate below still runs for its clearer message.
      if (!(await canPublishRevisionChange(callerContext, raw, entity))) {
        gates.push(
          makeBlockingGate({
            type: "permission-denied",
            messages: [
              `You do not have permission to publish this ${displayEntityName(
                targetType,
              )} in every environment it changes`,
            ],
          }),
        );
      }

      // A project move lands in the destination, so it takes publish authority
      // there over the environments the change reaches — the generic path checks
      // only `canUpdate` on the post-publish state, which cannot see the change.
      // Footprint from the pre-patch entity so the diff is still visible.
      if (
        !holdsMoveDestination({
          permissions: callerContext.permissions,
          model: targetType,
          action: "publish",
          existing: entity as ProjectScoped,
          proposed: { ...entity, ...desiredState } as ProjectScoped,
          environments:
            adapter.publishFootprint?.(
              callerContext,
              entity as Record<string, unknown>,
              raw.target.proposedChanges,
            ) ?? [],
        })
      ) {
        gates.push(
          makeBlockingGate({
            type: "permission-denied",
            messages: [
              `You do not have permission to publish this ${displayEntityName(
                targetType,
              )} into its destination project`,
            ],
          }),
        );
      }

      // Archiving is delete-class wherever the merge lands, so bulk publish
      // enforces it too — `canPublish` above only asks for publish authority.
      if (
        isArchiveTransition({
          proposed: desiredState.archived as boolean | undefined,
          current: (entity as { archived?: boolean }).archived,
        }) &&
        !callerContext.permissions.canRevisionAction(
          targetType,
          "delete",
          entity as { project?: string; projects?: string[] },
          // Same change-aware footprint the single-revision engine applies, so a
          // bulk archive can't clear a check the individual publish would fail.
          adapter.publishFootprint?.(
            callerContext,
            entity as Record<string, unknown>,
            raw.target.proposedChanges,
          ) ?? [],
        )
      ) {
        gates.push(
          makeBlockingGate({
            type: "permission-denied",
            messages: [
              `You do not have permission to archive this ${displayEntityName(
                targetType,
              )}.`,
            ],
          }),
        );
      }

      if (authorityRefused(gates)) return gates;

      // Entity-level guards + schema validation, evaluated against the
      // multi-entity end-state: the overlay context is both the read context
      // (models carry the overlay) and — via scanContextOverride — the scan
      // context every guard evaluator inside uses.
      if (adapter.collectPublishGates) {
        gates.push(
          ...(await adapter.collectPublishGates(
            overlayContext,
            entity,
            raw,
            desiredState,
          )),
        );
      }

      if (options.extraGates) {
        gates.push(
          ...(await options.extraGates({
            callerContext,
            overlayContext,
            entity,
            revision: raw,
            desiredState,
          })),
        );
      }

      return gates;
    },

    async prepareNoOpMerge(context, entity, revision) {
      await adapter.beforeNoOpMerge?.(
        context,
        entity,
        revision.raw as Revision,
      );
    },

    async claim(context, revision, baseline, { isApprovalBypass, comment }) {
      try {
        const merged = await context.models.revisions.merge(
          revision.id,
          context.userId,
          {
            bypass: isApprovalBypass,
            comment,
            expected: {
              status: baseline.revisionStatus,
              dateUpdated: baseline.revisionDateUpdated,
            },
          },
        );
        // The dateUpdated our merge left behind — releaseClaim pins its reopen
        // to it so a concurrent re-publish's successful merge isn't clobbered.
        revision.claimStamp = merged.dateUpdated;
        return true;
      } catch (e) {
        // A lost CAS race is the expected "false" outcome; anything else
        // (DB failure, permission error) must surface as itself, not a 409.
        if (e instanceof ConflictError) return false;
        throw e;
      }
    },

    async releaseClaim(context, revision) {
      // Reopen only the exact merge we made (status still "merged" AND the
      // dateUpdated our claim stamped). If a concurrent actor reopened and
      // re-published the revision in the meantime, the fingerprint misses and
      // we leave their published state alone — the orchestrator reports this
      // item as still-published (needs attention), never a silent clobber.
      const restored = await context.models.revisions.reopenAfterFailedApply(
        revision.id,
        context.userId,
        revision.raw as Revision,
        revision.claimStamp ?? null,
      );
      return restored !== null;
    },

    async applyPrecomputed(context, entity, revision, desiredState) {
      const raw = revision.raw as Revision;
      try {
        // The keys the write actually persisted (post updatable-filter and
        // post-normalization) — the exact set compensation may roll back.
        // Guarded on the pre-image the plan was computed against. The drift check
        // before claiming proves nothing about the moment of the write — a single
        // publish landing in between would otherwise be silently overwritten by
        // this older plan. A lost race throws, which routes the batch into the
        // existing compensation path.
        await runGuardedWrite(targetType, (entity as { id: string }).id, () =>
          adapter.applyChanges(context, entity, desiredState, {
            isRevert: !!raw.revertedFrom,
            guarded: true,
            // Reported AT the write, so a mid-cascade throw still leaves
            // compensation an exact ownership baseline. A re-read would risk
            // observing a concurrent writer and handing over their values.
            onPersisted: (applied) => {
              revision.persistedKeys = applied.persistedKeys;
              revision.writtenEntity = applied.written;
              // The SAME array the adapter keeps appending to, so descendant writes
              // made after this report still reach compensation.
              revision.cascade = applied.cascade;
            },
          }),
        );
      } catch (e) {
        // Whether anything landed is decided by the REPORT, not the error class.
        // A rejected CAS never reports — `onWritten` fires after the guard check —
        // so an unreported failure is the "wrote nothing" case. Keying off the
        // class instead was wrong in the one direction that matters:
        // `reconcileConfigDescendants` re-throws CasConflictError from a
        // DESCENDANT write, long after the root write landed AND reported, so a
        // live change was marked as having written nothing and compensation
        // returned clean while the item was reported rolled-back.
        //
        // Marked HERE rather than left to compensation, so a later post-apply read
        // cannot snapshot a concurrent WINNER's doc as this item's output —
        // compensation would then mistake their work for ours and erase it.
        if (revision.writtenEntity === undefined) {
          revision.persistedKeys = [];
          revision.casLost = true;
        }
        throw e;
      }
    },

    async restorePreImage(context, preImage, revision) {
      // Nothing was reported written, so there is nothing to put back. Set in the
      // apply's catch from the absence of a report rather than from the error
      // class — see there for why the class was the wrong signal.
      if (revision.casLost) return;
      const model = adapter.getModel(context);
      const current = await model?.getById((preImage as { id: string }).id);
      // Entity gone (concurrent hard-delete): can't restore a pre-image that no
      // longer exists → route to restore-failed (reported published).
      if (!current) {
        throw new Error(
          `bulk publish compensation: ${targetType} "${(preImage as { id: string }).id}" no longer exists — cannot restore its pre-image`,
        );
      }
      // The apply reports from INSIDE the document write, before audit logging and
      // the afterUpdate hooks, so a missing baseline means the write never landed —
      // and the `casLost` return above already covers that, because the apply's
      // catch derives it from the same absent report. A guard here comparing
      // `persistedKeys` against the baseline could never fire: `onPersisted`
      // assigns both together, and the only other writer clears both.
      // `null` is a REPORT: the apply ran and wrote nothing, so there is nothing to
      // put back and the item is cleanly not-applied.
      if (revision.writtenEntity === null) return;
      // `undefined` is the absence of a report, which now means the apply never
      // reached its entity write — every adapter reports from INSIDE that write,
      // before audit and the afterUpdate hooks. Nothing of ours is live, so the
      // item rolls back cleanly. That reading depends on the reporting placement:
      // move it back after the write returns and this becomes a silent
      // live-change-with-no-record, which is what H1 was.
      if (revision.writtenEntity === undefined) return;

      // Restore only the fields the apply persisted, so a key dropped by the
      // filter or by normalization can't clobber a concurrent writer's value.
      const persistedKeys = revision.persistedKeys ?? [];
      const written =
        (revision.writtenEntity as Record<string, unknown> | null) ?? {};
      // Same routine the direct-landing paths compensate with, so every write
      // path restores by the same rule.
      await restoreEntityPreImage({
        context,
        entityType: targetType,
        preImage: preImage as Record<string, unknown> & { id: string },
        persistedKeys,
        written,
      });

      // Descendants AFTER the root, in cascade order. Ancestor normalization is
      // unconditional on a revert, so a descendant restored while the root still
      // declares the field is stripped straight back — and reports success, because
      // the key is still in `persistedKeys` so nothing looks dropped. A throw here
      // keeps the claim, which is what leaves the item reported published.
      for (const write of revision.cascade ?? []) {
        await restoreEntityPreImage({
          context,
          entityType: targetType,
          preImage: write.before,
          persistedKeys: Object.keys(write.written),
          written: write.written,
        });
      }
    },

    async emitPublished(context, entity, revision) {
      const merged = await context.models.revisions.getById(revision.id);
      if (!merged) return;
      // Both, like every other landing path: `published` is the lifecycle event,
      // `reverted` names what this particular landing was.
      const webhooks = getRevisionWebhookAdapter(targetType);
      await webhooks?.dispatch(context, merged, { type: "published" });
      if (merged.revertedFrom) {
        await webhooks?.dispatch(context, merged, { type: "reverted" });
      }
    },

    async emitPublishFailed(context, entity, revision, reason) {
      const current =
        (await context.models.revisions.getById(revision.id)) ??
        (revision.raw as Revision);
      await getRevisionWebhookAdapter(targetType)?.dispatch(context, current, {
        type: "publishFailed",
        reason,
        terminal: false,
        attempts: 1,
      });
    },
  };
}
