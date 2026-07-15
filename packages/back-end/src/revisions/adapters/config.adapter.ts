import { ConfigInterface } from "shared/types/config";
import {
  Revision,
  getConstantRevisionChange,
  normalizeProposedChanges,
} from "shared/enterprise";
import {
  constantRequiresReview,
  constantResetReviewOnChange,
  constantAutopublishOnApproval,
  formatAncestorFieldConflictMessage,
} from "shared/util";
import {
  configValidator,
  configUpdatableFieldsSchema,
} from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import {
  EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import {
  reconcileConfigDescendants,
  assertConfigDescendantsReconcilable,
  assertConfigSchemaChangeSafeForDescendants,
} from "back-end/src/services/configReconcile";
import {
  assertConfigInvariantsValid,
  assertConfigValueValidForPublish,
} from "back-end/src/services/configValidation";
import { assertConfigNotLocked } from "back-end/src/services/configLock";
import {
  ArmAcknowledgments,
  buildArmAcknowledgments,
} from "back-end/src/services/armGuards";
import {
  captureConfigExperimentGuardAcknowledgment,
  configChangeAffectsServedValue,
  configRevisionAffectsServedValue,
} from "back-end/src/services/experimentGuard";
import { captureConfigLockAcknowledgment } from "back-end/src/services/configLockGuard";
import { assertConfigPublishGuards } from "back-end/src/services/publishGuards";
import { BadRequestError } from "back-end/src/util/errors";
import { normalizeConfigChangesAgainstAncestors } from "./configSchemaNormalize";

// Mirrors constant.adapter.ts (see it for rationale); only model + permissions differ.
// scopedOverrides (env/project variant selection) + its derived scopedConfig
// marker write IMMEDIATELY, never through a revision — so they must stay out of
// the revision snapshot too, or a draft would carry a stale copy that clobbers
// the live value on resolve/revert.
const SNAPSHOT_EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  "scopedOverrides",
  "scopedConfig",
]);
const SNAPSHOT_ALLOWED_KEYS = (
  Object.keys(configValidator.shape) as Array<keyof ConfigInterface>
).filter((k) => !SNAPSHOT_EXCLUDED_KEYS.has(k));

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
    const filteredChanges = filterUpdatableChanges(
      changes,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );

    if (Object.keys(filteredChanges).length === 0) return;

    // Publish-time "base wins" reconciliation: strip any contract-identical
    // field this config declares whose key a published ancestor now owns
    // (ancestors may have changed since the draft was authored); a
    // contract-DIFFERING re-declaration is rejected instead — its intent can't
    // be preserved by a strip. A lineage change (parent/extends) shifts which
    // keys the bases own, so the config's own schema is re-normalized even
    // when this revision didn't touch `schema`.
    const { changes: normalizedChanges, conflicting } =
      await normalizeConfigChangesAgainstAncestors(
        entity,
        filteredChanges,
        (config, schema) =>
          context.models.configs.normalizeSchemaAgainstAncestors(
            config,
            schema,
          ),
      );
    if (conflicting.length) {
      throw new BadRequestError(
        formatAncestorFieldConflictMessage(conflicting),
      );
    }

    const touchesLineageOrSchema =
      normalizedChanges.schema !== undefined ||
      normalizedChanges.parent !== undefined ||
      "extends" in normalizedChanges;

    // Dry run BEFORE the write: reject a publish that would create an
    // unresolvable sibling conflict at a descendant, so nothing is persisted
    // (vs. committing the root and then throwing from the post-write cascade),
    // then soft-warn when the change removes/retypes fields descendants use.
    if (touchesLineageOrSchema) {
      const proposedRoot = {
        ...entity,
        ...normalizedChanges,
      } as ConfigInterface;
      await assertConfigDescendantsReconcilable(context, proposedRoot);
      await assertConfigSchemaChangeSafeForDescendants(context, proposedRoot);
    }

    // Enforce cross-field invariants here — the chokepoint every publish path
    // (direct, scheduled, autopublish-on-approval) flows through — against the
    // revision's proposed (draft) state.
    await assertConfigInvariantsValid(
      context,
      {
        key: entity.key,
        name: entity.name,
        value: (normalizedChanges.value as string | undefined) ?? entity.value,
        schema:
          (normalizedChanges.schema as ConfigInterface["schema"]) ??
          entity.schema,
        parent:
          (normalizedChanges.parent as string | undefined) ?? entity.parent,
        extends:
          "extends" in normalizedChanges
            ? (normalizedChanges.extends as string[] | undefined)
            : entity.extends,
      },
      (normalizedChanges.value as string | undefined) ?? entity.value,
    );

    await context.models.configs.update(
      entity,
      normalizedChanges as Parameters<typeof context.models.configs.update>[1],
    );

    // Cascade the change down to descendants when the schema or lineage changed.
    if (touchesLineageOrSchema) {
      await reconcileConfigDescendants(context, entity.key);
    }
  },

  // Self-heal path: a retry after applyChanges wrote the root but failed before
  // (or during) the descendant cascade arrives here with no net change, so
  // applyChanges — and its cascade — would never run. Replay the reconcile
  // (idempotent) whenever the revision touched schema or lineage.
  async beforeNoOpMerge(
    context: Context,
    entity: ConfigInterface,
    revision: Revision,
  ): Promise<void> {
    const touchesLineageOrSchema = normalizeProposedChanges(
      revision.target.proposedChanges,
    ).some((op) =>
      ["schema", "parent", "extends"].includes(op.path.split("/")[1]),
    );
    if (!touchesLineageOrSchema) return;
    await reconcileConfigDescendants(context, entity.key);
  },

  // Arming a scheduled publish on a locked config would just fail at every
  // poller tick — reject up front (the REST schedule handler does the same).
  assertSchedulable(context: Context, entity: ConfigInterface): void {
    assertConfigNotLocked(entity);
  },

  // Snapshot the deferred-publish guard fingerprints when arming; each guard
  // throws (bypassably) if its live conflicts aren't acknowledged.
  async captureArmAcknowledgment(
    context: Context,
    entity: ConfigInterface,
    proposedChanges: unknown,
  ): Promise<ArmAcknowledgments | undefined> {
    const valueAffecting = configRevisionAffectsServedValue(proposedChanges);
    return buildArmAcknowledgments({
      experiment: await captureConfigExperimentGuardAcknowledgment(
        context,
        entity,
        proposedChanges,
      ),
      "config-lock": valueAffecting
        ? await captureConfigLockAcknowledgment(context, {
            source: "config",
            key: entity.key,
            project: entity.project,
          })
        : undefined,
    });
  },

  // Pre-merge gate (see EntityRevisionAdapter.assertPublishable): runs the full
  // publish-time validation against the proposed state BEFORE the revision is
  // marked merged, so a failing publish errors and leaves the draft open instead
  // of stranding it "merged". Mirrors the REST publish handler's pre-merge checks
  // (postConfigRevisionPublish). assertConfigValueValidForPublish also enforces
  // the cross-field invariants.
  async assertPublishable(
    context: Context,
    entity: ConfigInterface,
    desiredState: Record<string, unknown>,
    revision: Revision,
    options?: { isRevert?: boolean; deferred?: boolean },
  ): Promise<void> {
    // Pre-merge lock gate for the shared publishRevision action (auto-publish on
    // approval, scheduled-publish poller). Throwing here — before the merge is
    // claimed — leaves the draft open instead of stranding it "merged".
    assertConfigNotLocked(entity);

    const filteredChanges = filterUpdatableChanges(
      desiredState,
      entity as Record<string, unknown>,
      UPDATABLE_FIELDS,
    );
    if (Object.keys(filteredChanges).length === 0) return;

    // Experiment guard. `deferred` reflects THIS invocation (poller /
    // auto-publish-on-approval), not whether the revision has auto-publish armed —
    // so a manual "publish now" of an armed revision still gets the live override.
    // Skipped for a metadata-only publish (no served value changes → can't
    // disrupt an experiment), matching the direct-update path.
    if (configChangeAffectsServedValue(Object.keys(filteredChanges))) {
      await assertConfigPublishGuards(context, entity, revision, {
        armed: !!options?.deferred,
      });
    }

    // Normalize BEFORE the descendant dry-run (otherwise it sees an
    // un-normalized root that still declares an ancestor-owned key and reports
    // a spurious sibling conflict at a composing descendant), rejecting
    // contract-differing re-declarations pre-merge like applyChanges does.
    const { changes: normalizedChanges, conflicting } =
      await normalizeConfigChangesAgainstAncestors(
        entity,
        filteredChanges,
        (config, schema) =>
          context.models.configs.normalizeSchemaAgainstAncestors(
            config,
            schema,
          ),
      );
    if (conflicting.length) {
      throw new BadRequestError(
        formatAncestorFieldConflictMessage(conflicting),
      );
    }

    const touchesLineageOrSchema =
      normalizedChanges.schema !== undefined ||
      normalizedChanges.parent !== undefined ||
      "extends" in normalizedChanges;

    if (touchesLineageOrSchema) {
      const proposedRoot = {
        ...entity,
        ...normalizedChanges,
      } as ConfigInterface;
      await assertConfigDescendantsReconcilable(context, proposedRoot);
      await assertConfigSchemaChangeSafeForDescendants(context, proposedRoot);
    }

    const postValue =
      (normalizedChanges.value as string | undefined) ?? entity.value;
    await assertConfigValueValidForPublish(
      context,
      {
        key: entity.key,
        name: entity.name,
        value: postValue,
        schema:
          (normalizedChanges.schema as ConfigInterface["schema"]) ??
          entity.schema,
        parent:
          (normalizedChanges.parent as string | undefined) ?? entity.parent,
        extends:
          "extends" in normalizedChanges
            ? (normalizedChanges.extends as string[] | undefined)
            : entity.extends,
        extensible: entity.extensible,
      },
      { value: postValue },
      revision,
    );
  },
};
