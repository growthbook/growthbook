import { isEqual } from "lodash";
import { ConstantInterface } from "shared/types/constant";
import {
  Revision,
  getApprovalFlowSettings,
  isConstantRevisionMetadataOnly,
} from "shared/enterprise";
import {
  constantValidator,
  constantUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";

// Whitelist of fields the snapshot is allowed to carry, derived from the schema
// so the two can't drift. The snapshot validator runs in `.strict()` mode, so a
// leftover legacy field on a stored entity would otherwise fail validation.
const SNAPSHOT_ALLOWED_KEYS = Object.keys(constantValidator.shape) as Array<
  keyof ConstantInterface
>;

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(constantUpdatableFieldsSchema.shape),
);

// User must be able to bypass approval in EVERY project the constant belongs to
// (treats the empty-projects case as the global "" project). Used both for the
// bypass-approval gate and for non-author revision deletion, since discarding
// someone else's in-flight revision is an admin-level action.
function canBypassAcrossProjects(
  context: Context,
  snapshot: ConstantInterface,
): boolean {
  const projects = snapshot.projects?.length ? snapshot.projects : [""];
  return projects.every((project) =>
    context.permissions.canBypassApprovalChecks({ project }),
  );
}

// canCreate and canUpdate both gate on the constant edit permission; extract so
// the two stay in sync.
function canEditConstant(
  context: Context,
  snapshot: ConstantInterface,
): boolean {
  return context.permissions.canUpdateConstant(snapshot, {});
}

function isConstantApprovalRequired(context: Context): boolean {
  return (
    context.hasPremiumFeature("require-approvals") &&
    !!context.org.settings?.approvalFlows?.constants?.[0]?.required
  );
}

export const constantAdapter: EntityRevisionAdapter<ConstantInterface> = {
  getModel(context: Context) {
    return context.models.constants as {
      getById(id: string): Promise<ConstantInterface | null>;
    };
  },

  buildSnapshot(entity: ConstantInterface): ConstantInterface {
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
    return snapshot as unknown as ConstantInterface;
  },

  isRevisionRequired(context: Context): boolean {
    return isConstantApprovalRequired(context);
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: ConstantInterface): boolean {
    return context.permissions.canReadMultiProjectResource(snapshot.projects);
  },

  canCreate(context: Context, snapshot: ConstantInterface): boolean {
    return canEditConstant(context, snapshot);
  },

  canUpdate(context: Context, snapshot: ConstantInterface): boolean {
    return canEditConstant(context, snapshot);
  },

  // Gates non-author deletion of a revision document (authors can always delete
  // their own — see RevisionModel.canDelete). Restricted to users who can
  // bypass approval, since discarding another user's in-flight revision is an
  // admin-level action.
  canDelete(context: Context, snapshot: ConstantInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return isConstantApprovalRequired(context);
  },

  // Per-revision gate: when the org has approval enabled but disabled the
  // `requireMetadataReview` toggle, a revision whose proposed changes only touch
  // metadata fields can skip review entirely. Mirrors the metadata-only
  // autoPublish shortcut in PUT /constants/:id so the generic
  // /revision/:id/merge endpoint reaches the same conclusion.
  isApprovalRequiredForRevision(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;

    const settings = getApprovalFlowSettings(
      context.org.settings?.approvalFlows,
      "constant",
    );
    if (!settings?.required) return false;
    const metadataReviewRequired = settings.requireMetadataReview ?? true;
    if (metadataReviewRequired) return true;
    return !isConstantRevisionMetadataOnly(revision.target.proposedChanges);
  },

  canBypassApproval(context: Context, snapshot: ConstantInterface): boolean {
    return canBypassAcrossProjects(context, snapshot);
  },

  async applyChanges(
    context: Context,
    entity: ConstantInterface,
    changes: Record<string, unknown>,
  ): Promise<void> {
    // Filter to updatable fields and only include fields that actually differ.
    const filteredChanges: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      if (!UPDATABLE_FIELDS.has(key)) continue;
      const newVal = changes[key];
      const currentVal = (entity as Record<string, unknown>)[key];
      if (newVal !== undefined && !isEqual(newVal, currentVal)) {
        filteredChanges[key] = newVal;
      }
    }

    if (Object.keys(filteredChanges).length === 0) return;

    await context.models.constants.update(
      entity,
      filteredChanges as Parameters<typeof context.models.constants.update>[1],
    );
  },
};
