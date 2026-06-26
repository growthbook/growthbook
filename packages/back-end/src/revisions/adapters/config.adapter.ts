import { isEqual } from "lodash";
import { ConfigInterface } from "shared/types/config";
import { Revision, getConstantRevisionChange } from "shared/enterprise";
import {
  constantRequiresReview,
  constantResetReviewOnChange,
  constantAutopublishOnApproval,
} from "shared/util";
import {
  configValidator,
  configUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import { reconcileConfigDescendants } from "back-end/src/services/configReconcile";

// Mirrors constant.adapter.ts (see it for rationale); only model + permissions differ.
const SNAPSHOT_ALLOWED_KEYS = Object.keys(configValidator.shape) as Array<
  keyof ConfigInterface
>;

const UPDATABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(configUpdatableFieldsSchema.shape),
);

function canBypassApprovalForConfig(
  context: Context,
  snapshot: ConfigInterface,
): boolean {
  return context.permissions.canBypassApprovalChecks({
    project: snapshot.project || "",
  });
}

function canEditConfig(context: Context, snapshot: ConfigInterface): boolean {
  return context.permissions.canUpdateConfig(snapshot, {});
}

function configApprovalConfigured(context: Context): boolean {
  if (!context.hasPremiumFeature("require-approvals")) return false;
  const requireReviews = context.org.settings?.requireReviews;
  if (typeof requireReviews === "boolean") return requireReviews;
  return (
    Array.isArray(requireReviews) &&
    requireReviews.some((r) => r.requireReviewOn)
  );
}

export const configAdapter: EntityRevisionAdapter<ConfigInterface> = {
  getModel(context: Context) {
    return context.models.configs as {
      getById(id: string): Promise<ConfigInterface | null>;
    };
  },

  buildSnapshot(entity: ConfigInterface): ConfigInterface {
    const source = entity as Record<string, unknown>;
    const snapshot: Record<string, unknown> = {};
    for (const key of SNAPSHOT_ALLOWED_KEYS) {
      const value = source[key];
      if (value === null || value === undefined) continue;
      snapshot[key] = value;
    }
    return snapshot as unknown as ConfigInterface;
  },

  isRevisionRequired(context: Context): boolean {
    return configApprovalConfigured(context);
  },

  getUpdatableFields(): ReadonlySet<string> {
    return UPDATABLE_FIELDS;
  },

  canRead(context: Context, snapshot: ConfigInterface): boolean {
    return context.permissions.canReadSingleProjectResource(snapshot.project);
  },

  canCreate(context: Context, snapshot: ConfigInterface): boolean {
    return canEditConfig(context, snapshot);
  },

  canUpdate(context: Context, snapshot: ConfigInterface): boolean {
    return canEditConfig(context, snapshot);
  },

  canDelete(context: Context, snapshot: ConfigInterface): boolean {
    return canBypassApprovalForConfig(context, snapshot);
  },

  isApprovalRequired(context: Context): boolean {
    return configApprovalConfigured(context);
  },

  isApprovalRequiredForRevision(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConfigInterface;
    return constantRequiresReview(
      { project: snapshot.project },
      getConstantRevisionChange(snapshot, revision.target.proposedChanges),
      context.org.settings,
    );
  },

  canBypassApproval(context: Context, snapshot: ConfigInterface): boolean {
    return canBypassApprovalForConfig(context, snapshot);
  },

  shouldResetReviewOnChange(context: Context, revision: Revision): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    const snapshot = revision.target.snapshot as ConfigInterface;
    const { valueChanged, changedEnvironments } = getConstantRevisionChange(
      snapshot,
      revision.target.proposedChanges,
    );
    return constantResetReviewOnChange(
      { project: snapshot.project },
      { valueChanged, changedEnvironments },
      context.org.settings,
    );
  },

  isAutopublishOnApprovalEnabled(
    context: Context,
    snapshot: ConfigInterface,
  ): boolean {
    if (!context.hasPremiumFeature("require-approvals")) return false;
    return constantAutopublishOnApproval(
      { project: snapshot.project },
      context.org.settings,
    );
  },

  async applyChanges(
    context: Context,
    entity: ConfigInterface,
    changes: Record<string, unknown>,
    options?: { isRevert?: boolean },
  ): Promise<void> {
    void options;
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

    // Publish-time "base wins" reconciliation: strip any field this config
    // declares whose key a published ancestor now owns (ancestors may have
    // changed since the draft was authored), then apply.
    if (filteredChanges.schema) {
      filteredChanges.schema =
        await context.models.configs.normalizeSchemaAgainstAncestors(
          {
            key: entity.key,
            parent:
              (filteredChanges.parent as string | undefined) ?? entity.parent,
            value:
              (filteredChanges.value as string | undefined) ?? entity.value,
          },
          filteredChanges.schema as ConfigInterface["schema"],
        );
    }

    await context.models.configs.update(
      entity,
      filteredChanges as Parameters<typeof context.models.configs.update>[1],
    );

    // Cascade the change down to descendants when the schema changed.
    if (filteredChanges.schema !== undefined) {
      await reconcileConfigDescendants(context, entity.key);
    }
  },
};
