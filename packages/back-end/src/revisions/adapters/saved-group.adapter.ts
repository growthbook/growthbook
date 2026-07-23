import { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  getApprovalFlowSettings,
  isSavedGroupRevisionMetadataOnly,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  savedGroupValidator,
  savedGroupUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  ArmAcknowledgments,
  buildArmAcknowledgments,
} from "back-end/src/services/armGuards";

// The archive-dependents guard is imported lazily inside the methods below.
// saved-group.adapter is the FIRST adapter loaded by revisions/index, and the
// guard pulls in the services graph (savedGroups → features → …) which cycles
// back through RevisionModel → revisions/index; a top-level import would touch
// `savedGroupAdapter` before this module finishes initializing. Deferring the
// import to call time (well after module init) breaks the cycle. The
// config/constant adapters already import the heavy services graph, so they use
// a normal top-level import.
type ArchiveDependentsGuard =
  typeof import("back-end/src/services/archiveDependentsGuard");
function loadArchiveDependentsGuard(): Promise<ArchiveDependentsGuard> {
  return import("back-end/src/services/archiveDependentsGuard");
}

// Whitelist of fields the snapshot is allowed to carry, derived from the
// schema so the two can't drift. The snapshot validator runs in `.strict()`
// mode, so any leftover legacy field on the stored entity (e.g.
// `passByReferenceOnly`, removed in #2904) would otherwise fail validation.
const SNAPSHOT_ALLOWED_KEYS = Object.keys(savedGroupValidator.shape) as Array<
  keyof SavedGroupInterface
>;

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(savedGroupUpdatableFieldsSchema.shape),
);

// User must be able to bypass approval in EVERY project the saved group
// belongs to (treats the empty-projects case as the global "" project).
// Used both for the bypass-approval gate and for non-author revision deletion,
// since discarding someone else's in-flight revision is an admin-level action.
function canBypassAcrossProjects(
  context: Context,
  snapshot: SavedGroupInterface,
): boolean {
  const projects = snapshot.projects?.length ? snapshot.projects : [""];
  return projects.every((project) =>
    context.permissions.canBypassApprovalChecks({ project }),
  );
}

// canCreate and canUpdate both gate on the saved-group edit permission;
// extract so the two stay in sync.
function canEditSavedGroup(
  context: Context,
  snapshot: SavedGroupInterface,
): boolean {
  return context.permissions.canUpdateSavedGroup(snapshot, {});
}

function isSavedGroupApprovalRequired(context: Context): boolean {
  return (
    context.hasPremiumFeature("require-approvals") &&
    !!context.org.settings?.approvalFlows?.savedGroups?.[0]?.required
  );
}

export const savedGroupAdapter: EntityRevisionAdapter<SavedGroupInterface> = {
  getModel(context: Context) {
    return context.models.savedGroups as {
      getById(id: string): Promise<SavedGroupInterface | null>;
    };
  },

  buildSnapshot(entity: SavedGroupInterface): SavedGroupInterface {
    // Pick only schema-defined keys and drop nullish optional fields. This
    // strips MongoDB internals (`_id`) as well as any legacy fields that may
    // still exist on stored docs from earlier schema versions.
    const source = entity as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const key of SNAPSHOT_ALLOWED_KEYS) {
      const value = source[key];
      if (value === null || value === undefined) continue;
      snapshot[key] = value;
    }
    return snapshot as unknown as SavedGroupInterface;
  },

  isRevisionRequired(context: Context): boolean {
    return isSavedGroupApprovalRequired(context);
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canReadMultiProjectResource(snapshot.projects);
  },

  canCreate(context: Context, snapshot: SavedGroupInterface): boolean {
    return canEditSavedGroup(context, snapshot);
  },

  canUpdate(context: Context, snapshot: SavedGroupInterface): boolean {
    return canEditSavedGroup(context, snapshot);
  },

  // Gates non-author deletion of a revision document (authors can always
  // delete their own — see RevisionModel.canDelete). Restricted to users who
  // can bypass approval, since discarding another user's in-flight revision
  // is an admin-level action.
  canDelete(context: Context, snapshot: SavedGroupInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  // Saved groups have no environment concept, so publish/revert are
  // project-scoped (unlike the Flags family).
  canManageDrafts(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canManageSavedGroupDrafts(snapshot);
  },

  canReview(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canReviewSavedGroup(snapshot);
  },

  canPublishRevision(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canPublishSavedGroup(snapshot);
  },

  canRevert(context: Context, snapshot: SavedGroupInterface): boolean {
    return context.permissions.canRevertSavedGroup(snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return isSavedGroupApprovalRequired(context);
  },

  // Per-revision gate: when the org has approval enabled but disabled the
  // `requireMetadataReview` toggle, a revision whose proposed changes only
  // touch metadata fields can skip review entirely. Mirrors the
  // metadata-only autoPublish shortcut in PUT /saved-groups/:id so the
  // generic /revision/:id/merge endpoint reaches the same conclusion.
  isApprovalRequiredForRevision(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;

    const settings = getApprovalFlowSettings(
      context.org.settings?.approvalFlows,
      "saved-group",
    );
    if (!settings?.required) return false;
    const metadataReviewRequired = settings.requireMetadataReview ?? true;
    if (metadataReviewRequired) return true;
    return !isSavedGroupRevisionMetadataOnly(revision.target.proposedChanges);
  },

  canBypassApproval(context: Context, snapshot: SavedGroupInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  async applyChanges(
    context: Context,
    entity: SavedGroupInterface,
    changes: Record<string, unknown>,
    options?: { isRevert?: boolean },
  ): Promise<string[]> {
    const filteredChanges = filterUpdatableChanges(
      changes,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );

    if (Object.keys(filteredChanges).length === 0) return [];

    // Reverts restore a previously-published condition as-is; skip the
    // registered-attributes check so an attribute removed/archived since the
    // snapshot was taken doesn't block the revert.
    await context.models.savedGroups.update(
      entity,
      filteredChanges as Parameters<
        typeof context.models.savedGroups.update
      >[1],
      options?.isRevert ? { skipAttributeValidation: true } : undefined,
    );
    return Object.keys(filteredChanges);
  },

  // Snapshot the archive-dependents fingerprint when arming a deferred publish
  // (schedule / auto-publish-on-approval), captured only for the archive
  // direction. Throws (bypassably) if the archive's live dependents aren't
  // acknowledged. Saved groups use the generic revision machinery, so — unlike
  // features — they support the full arm/fire fingerprint.
  async captureArmAcknowledgment(
    context: Context,
    entity: SavedGroupInterface,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined> {
    // Detect the archived value this revision would publish straight from its
    // patch ops (avoids importing revisions/util here — it cycles back through
    // revisions/index, which loads this adapter first).
    const archivedOp = normalizeProposedChanges(proposedChanges).find(
      (op) => op.path === "/archived" && "value" in op,
    ) as { value?: unknown } | undefined;
    const proposedArchived = archivedOp
      ? !!archivedOp.value
      : !!entity.archived;
    const isArchiveTransition = proposedArchived && !entity.archived;
    const { captureSavedGroupArchiveDependentsAcknowledgment } =
      await loadArchiveDependentsGuard();
    return buildArmAcknowledgments({
      "archive-dependents": isArchiveTransition
        ? await captureSavedGroupArchiveDependentsAcknowledgment(context, {
            id: entity.id,
          })
        : undefined,
    });
  },

  // Pre-merge gate for every generic/deferred publish (revisionActions
  // publishRevision — scheduled poller, auto-publish-on-approval, generic
  // /revision merge). Soft-warns when the archive transition drops live
  // dependents; a deferred fire re-checks against the arm-time fingerprint
  // (terminal on a NEW dependent). The dedicated REST publish handler
  // (postSavedGroupRevisionPublish) doesn't run assertPublishable — it emits the
  // gate inline.
  async assertPublishable(
    context: Context,
    entity: SavedGroupInterface,
    desiredState: Record<string, unknown>,
    revision: Revision,
    options?: { isRevert?: boolean; deferred?: boolean },
  ): Promise<void> {
    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    const proposedArchived =
      "archived" in filteredChanges ? !!filteredChanges.archived : undefined;
    if (proposedArchived === true && !entity.archived) {
      const { assertSavedGroupArchiveDependentsGuard } =
        await loadArchiveDependentsGuard();
      await assertSavedGroupArchiveDependentsGuard(
        context,
        { id: entity.id },
        { armed: !!options?.deferred },
        revision,
      );
    }
  },
};
