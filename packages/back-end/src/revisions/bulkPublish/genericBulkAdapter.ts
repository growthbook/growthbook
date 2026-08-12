import { bypassApprovalPermission } from "shared/permissions";
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
import { resolvePublishFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
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

// Adapts generic RevisionModel entities while allowing entity-specific plan gates.
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
      // Collect governance in caller context, then perform authoritative landing checks.
      const gates: PublishGate[] = collectRevisionGovernanceGates({
        context: callerContext,
        adapter,
        targetType,
        entity,
        revision: raw,
      });

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

      // A relocation also requires landing authority over the destination footprint.
      if (
        !holdsMoveDestination({
          permissions: callerContext.permissions,
          model: targetType,
          action: "publish",
          existing: entity as ProjectScoped,
          proposed: { ...entity, ...desiredState } as ProjectScoped,
          environments: resolvePublishFootprint(
            callerContext,
            adapter.publishFootprint?.(
              callerContext,
              entity,
              raw.target.proposedChanges,
            ),
            entity as ProjectScoped,
          ),
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

      // Archiving additionally requires delete authority over the same footprint.
      if (
        isArchiveTransition({
          proposed: desiredState.archived as boolean | undefined,
          current: (entity as { archived?: boolean }).archived,
        }) &&
        !callerContext.permissions.canRevisionAction(
          targetType,
          "delete",
          entity as { project?: string; projects?: string[] },
          resolvePublishFootprint(
            callerContext,
            adapter.publishFootprint?.(
              callerContext,
              entity,
              raw.target.proposedChanges,
            ),
            entity as ProjectScoped,
          ),
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

      // Match the single-publish sibling-schedule gate and bypass behavior.
      if (
        await callerContext.models.revisions.hasPublishLockingScheduledSibling(
          raw.target,
          raw.id,
        )
      ) {
        gates.push(
          makeBlockingGate({
            type: "publish-locking-sibling",
            messages: [
              `Another draft of this ${displayEntityName(
                targetType,
              )} has a scheduled publish that locks other drafts. Cancel that schedule first.`,
            ],
            requiresPermission: bypassApprovalPermission(targetType),
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
        revision.claimStamp = merged.dateUpdated;
        return true;
      } catch (e) {
        // Only claim CAS conflicts become the expected false result.
        if (e instanceof ConflictError) return false;
        throw e;
      }
    },

    async releaseClaim(context, revision) {
      // Reopen only this claim, preserving any concurrent re-publish.
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
        // Guard the write on its plan-time pre-image and report persisted state.
        await runGuardedWrite(targetType, (entity as { id: string }).id, () =>
          adapter.applyChanges(context, entity, desiredState, {
            isRevert: !!raw.revertedFrom,
            guarded: true,
            onPersisted: (applied) => {
              revision.persistedKeys = applied.persistedKeys;
              revision.writtenEntity = applied.written;
              revision.cascade = applied.cascade;
            },
          }),
        );
      } catch (e) {
        // Determine whether anything landed from the write report, not the error class.
        if (revision.writtenEntity === undefined) {
          revision.persistedKeys = [];
          revision.casLost = true;
        }
        throw e;
      }
    },

    async restorePreImage(context, preImage, revision) {
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
      // null is a reported no-op; undefined means no entity write was reported.
      if (revision.writtenEntity === null) return;
      if (revision.writtenEntity === undefined) return;

      // Restore only fields actually persisted.
      const persistedKeys = revision.persistedKeys ?? [];
      const written =
        (revision.writtenEntity as Record<string, unknown> | null) ?? {};
      await restoreEntityPreImage({
        context,
        entityType: targetType,
        preImage: preImage as Record<string, unknown> & { id: string },
        persistedKeys,
        written,
      });

      // Restore descendants after the root so normalization does not strip them again.
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
