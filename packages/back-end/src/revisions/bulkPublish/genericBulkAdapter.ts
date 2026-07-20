import { isEqual } from "lodash";
import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import type { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { MergeConflictError } from "back-end/src/util/errors";
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

/**
 * Bulk-publish surface for any entity on the generic revision system
 * (saved-group, constant, config, and whatever registers next). Wraps the
 * entity's EntityRevisionAdapter for entity behavior and the shared
 * RevisionModel for revision lifecycle. `extraGates` lets a type contribute
 * gates its single-entity REST handler assembles inline (e.g. the config
 * handler's config-locked gate) without the orchestrator knowing the type.
 */
export function makeGenericBulkAdapter(
  targetType: RevisionTargetType,
  adapter: EntityRevisionAdapter,
  options?: {
    extraGates?: (args: {
      callerContext: Context;
      overlayContext: Context;
      entity: Record<string, unknown>;
      revision: Revision;
      desiredState: Record<string, unknown>;
    }) => Promise<PublishGate[]>;
  },
): BulkPublishableAdapter {
  return {
    staleBaseForceAllowsRestBypass: true,

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

    canPublish(context, entity) {
      return adapter.canPublishRevision
        ? adapter.canPublishRevision(context, entity)
        : adapter.canUpdate(context, entity);
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
      const conflictResult = checkMergeConflicts(
        snapshot,
        entity,
        normalizeProposedChanges(raw.target.proposedChanges),
        adapter.getUpdatableFields(),
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
        adapter.getUpdatableFields(),
      );
      const updatable = adapter.getUpdatableFields();
      // isEqual, matching filterUpdatableChanges — key-order-sensitive
      // stringify would misroute deep-equal no-ops into the apply path.
      const hasChanges = Object.keys(desiredState).some(
        (key) => updatable.has(key) && !isEqual(desiredState[key], entity[key]),
      );
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
      // Approval + stale-base via the shared collector (approval scoping —
      // project/env/metadata rules — stays inside each adapter's
      // isApprovalRequiredForRevision). Caller context: governance is about
      // the caller's org policy, not the overlay end-state.
      const gates: PublishGate[] = collectRevisionGovernanceGates({
        context: callerContext,
        adapter,
        targetType,
        entity,
        revision: raw,
      });

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

      if (options?.extraGates) {
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
        await context.models.revisions.merge(revision.id, context.userId, {
          bypass: isApprovalBypass,
          comment,
          expected: {
            status: baseline.revisionStatus,
            dateUpdated: baseline.revisionDateUpdated,
          },
        });
        return true;
      } catch {
        return false;
      }
    },

    async releaseClaim(context, revision) {
      const restored = await context.models.revisions.reopenAfterFailedApply(
        revision.id,
        context.userId,
        revision.raw as Revision,
      );
      if (!restored) {
        await context.models.revisions.reopen(revision.id, context.userId);
      }
    },

    async applyPrecomputed(context, entity, revision, desiredState) {
      const raw = revision.raw as Revision;
      await adapter.applyChanges(context, entity, desiredState, {
        isRevert: !!raw.revertedFrom,
      });
    },

    async restorePreImage(context, preImage, revision, desiredState) {
      const model = adapter.getModel(context);
      const current = await model?.getById((preImage as { id: string }).id);
      if (!current) return;
      // Restore only the fields the apply wrote — writing back every
      // updatable field would clobber an unrelated concurrent update landing
      // between the drift check and compensation.
      const updatable = adapter.getUpdatableFields();
      const restore: Record<string, unknown> = {};
      for (const key of Object.keys(desiredState)) {
        if (!updatable.has(key)) continue;
        const original = (preImage as Record<string, unknown>)[key];
        if (isEqual(desiredState[key], original)) continue;
        // null (not undefined) as the clear signal so the write layer's
        // updatable-changes filter doesn't drop fields the apply added.
        restore[key] = original === undefined ? null : original;
      }
      if (!Object.keys(restore).length) return;
      await adapter.applyChanges(context, current, restore, {
        // Restoring a pre-image is semantically a revert to a known-good
        // published state — skip validations that would block a restore.
        isRevert: true,
      });
    },

    async emitPublished(context, entity, revision) {
      const merged = await context.models.revisions.getById(revision.id);
      if (!merged) return;
      await getRevisionWebhookAdapter(targetType)?.dispatch(context, merged, {
        type: merged.revertedFrom ? "reverted" : "published",
      });
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
