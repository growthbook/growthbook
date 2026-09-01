import isEqual from "lodash/isEqual";
import type {
  ApprovalFlowConfiguration,
  ApprovalFlowConfigurations,
  ApprovalFlowPolicy,
  OrganizationSettings,
} from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type { ConstantInterface } from "shared/types/constant";
import type {
  RevisionTargetType,
  Revision,
  RevisionEntity,
  Conflict,
  MergeResult,
  JsonPatchOperation,
} from "../validators/revisions";
// Constants borrow the feature `requireReviews` model rather than the
// saved-group `approvalFlows` config, so self-approval / autopublish are read
// from there. Imported from the specific file (not the barrel) to avoid a
// runtime import cycle.
import {
  constantBlockSelfApproval,
  constantAutopublishOnApproval,
} from "../util/features";
// Specific files (not the barrel) to avoid a runtime import cycle.
import { configUpdatableFieldsSchema } from "../validators/config";
import { constantUpdatableFieldsSchema } from "../validators/constant";
import { savedGroupUpdatableFieldsSchema } from "../validators/saved-group";
import {
  resolveProjectScopedRule,
  RuleCombiners,
} from "../util/projectScopedRules";

// One project for a constant or config, several for a saved group.
export const entityProjects = (snapshot: unknown): string[] => {
  const entity = (snapshot ?? {}) as {
    project?: string;
    projects?: string[];
    // The SDK-connection snapshot is composite, so its scope lives one level
    // down. Without this every project-scoped approval rule resolved against an
    // empty list and was invisible to self-approval blocking, review reset and
    // autopublish.
    sdkConnection?: { project?: string; projects?: string[] };
  };
  const scope = entity.sdkConnection ?? entity;
  if (scope.projects?.length) return scope.projects;
  return scope.project ? [scope.project] : [];
};

// Stricter wins; autopublish takes agreement; team lists union into one OR-group.
const APPROVAL_FLOW_COMBINERS: RuleCombiners<ApprovalFlowConfiguration> = {
  required: (vals) => vals.some(Boolean),
  requireMetadataReview: (vals) => vals.some((v) => v !== false),
  blockSelfApproval: (vals) => vals.some(Boolean),
  resetReviewOnChange: (vals) => vals.some(Boolean),
  autopublishOnApproval: (vals) => vals.every(Boolean),
  requiredApproverTeams: (vals) =>
    [...new Set(vals.flatMap((v) => v ?? []))].sort(),
};

// `projects` is the selector and `required` the override's own switch.
const APPROVAL_FLOW_INHERITABLE = [
  "requireMetadataReview",
  "blockSelfApproval",
  "autopublishOnApproval",
  "resetReviewOnChange",
  "requiredApproverTeams",
] as const;

/**
 * The approval-flow rules for an entity type.
 *
 * Extension point: when introducing a new RevisionTargetType, add a `case`
 * mapping it to the corresponding key on `ApprovalFlowConfigurations`.
 */
const approvalFlowRulesFor = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
  entityType: RevisionTargetType,
): ApprovalFlowConfiguration[] => {
  if (!approvalFlows) return [];
  switch (entityType) {
    case "saved-group":
      return approvalFlows.savedGroups ?? [];
    case "sdk-connection":
      return approvalFlows.sdkConnections ?? [];
    // Constants don't use this config — they inherit the feature `requireReviews`
    // settings (see constantRequiresReview).
    case "config":
    case "constant":
    default:
      return [];
  }
};

// One rule per governing project: each is its own requirement, so no winner.
export const getApprovalFlowRules = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
  entityType: RevisionTargetType,
  projects: string[] = [],
): ApprovalFlowConfiguration[] => {
  const rules = approvalFlowRulesFor(approvalFlows, entityType);
  if (!rules.length) return [];
  const scopes: (string | undefined)[] = projects.length
    ? projects
    : [undefined];
  const seen = new Set<string>();
  const resolved: ApprovalFlowConfiguration[] = [];
  for (const project of scopes) {
    const rule = resolveProjectScopedRule(
      rules,
      project,
      APPROVAL_FLOW_INHERITABLE,
      APPROVAL_FLOW_COMBINERS,
      (r) => !!r.required,
    );
    if (!rule) continue;
    // By content: inherited layers resolve to equal but distinct objects.
    const key = JSON.stringify(rule);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(rule);
  }
  return resolved;
};

// The toggles for one entity: stricter wins across governing projects, except
// autopublish, which loosens the flow and so needs all of them to agree.
export const getApprovalFlowSettings = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
  entityType: RevisionTargetType,
  projects: string[] = [],
): ApprovalFlowPolicy | undefined => {
  const rules = getApprovalFlowRules(approvalFlows, entityType, projects);
  if (!rules.length) return undefined;
  if (rules.length === 1) return rules[0];
  return {
    required: rules.some((r) => r.required),
    requireMetadataReview: rules.some((r) => r.requireMetadataReview !== false),
    blockSelfApproval: rules.some((r) => !!r.blockSelfApproval),
    resetReviewOnChange: rules.some((r) => !!r.resetReviewOnChange),
    autopublishOnApproval: rules.every((r) => !!r.autopublishOnApproval),
  };
};

/**
 * Top-level saved-group fields that count as "metadata" for the purposes of
 * the `requireMetadataReview` gate. When the org has saved-group approval
 * enabled but metadata review disabled, revisions whose proposed changes
 * touch only these fields can be published without going through review.
 *
 * Content fields (`values`, `condition`, `attributeKey`, `useEmptyListGroup`)
 * always require full review when approval is enabled.
 */
export const SAVED_GROUP_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "groupName",
  "owner",
  "description",
  "projects",
  "archived",
]);

/**
 * Returns true when every proposed change in the revision touches a
 * saved-group metadata field (per `SAVED_GROUP_METADATA_FIELDS`). An empty
 * proposed-changes list returns false — there's nothing to publish, so the
 * "metadata-only shortcut" doesn't apply.
 *
 * Used to decide whether the `requireMetadataReview` gate lets a revision
 * be merged without approval.
 */
export const isSavedGroupRevisionMetadataOnly = (
  proposedChanges: JsonPatchOperation[] | unknown,
): boolean => {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return false;
  return ops.every((op) => {
    const field = op.path.split("/")[1];
    return !!field && SAVED_GROUP_METADATA_FIELDS.has(field);
  });
};

/**
 * Top-level constant fields that count as "metadata" for the `requireMetadataReview`
 * gate. The content fields (`value`, `environmentValues`) always require full
 * review when approval is enabled, since they change the value the SDK resolves.
 */
export const CONSTANT_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "owner",
  "description",
  "project",
  "archived",
]);

// Config-only fields whose change affects the value the SDK resolves (so they
// must require full review when approval is enabled, like `value`). Constants
// never carry these, so they're inert for constant revisions.
const CONFIG_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  "schema",
  "parent",
  "extends",
  "extensible",
  // NOTE: `scopedOverrides` is NOT here — the env/project variant selection writes
  // immediately (setConfigScopedOverrides), never through a revision, so it's
  // never part of a revision's proposed changes.
]);

/**
 * Returns true when every proposed change in the revision touches a constant
 * metadata field (per `CONSTANT_METADATA_FIELDS`). An empty proposed-changes
 * list returns false. Mirrors `isSavedGroupRevisionMetadataOnly`.
 */
export const isConstantRevisionMetadataOnly = (
  proposedChanges: JsonPatchOperation[] | unknown,
): boolean => {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return false;
  return ops.every((op) => {
    const field = op.path.split("/")[1];
    return !!field && CONSTANT_METADATA_FIELDS.has(field);
  });
};

/**
 * What RESTORING a historical revision would change, measured against the entity as
 * it stands now: which per-environment overrides differ, and where the restored
 * state would live.
 *
 * This is the question every revert authority check asks, and it is not the one
 * `getConstantRevisionChange` answers — that reports what the revision changed when
 * it was published, which a later change can have superseded. Shared so the revert
 * endpoint and the controls that predict it derive the same footprint.
 */
export const getConstantRestoreChange = (
  live: Pick<ConstantInterface, "environmentValues"> & { project?: string },
  target: {
    snapshot: unknown;
    proposedChanges: JsonPatchOperation[] | unknown;
  },
): {
  changedEnvironments: string[];
  restoredProject?: string;
  /**
   * The restoration carries an op this applier couldn't read, so
   * `changedEnvironments` is a floor rather than the answer. Callers deriving
   * authority from it must widen instead of narrowing — an empty list would
   * otherwise skip the environment check entirely.
   */
  unresolvedOps: boolean;
} => {
  const restored = applyTopLevelPatchOps(
    (target.snapshot ?? {}) as Record<string, unknown>,
    normalizeProposedChanges(target.proposedChanges),
  ) as Pick<ConstantInterface, "environmentValues"> & { project?: string };

  const liveEnvs = live.environmentValues ?? {};
  const restoredEnvs = restored.environmentValues ?? {};
  const changedEnvironments = [
    ...new Set([...Object.keys(liveEnvs), ...Object.keys(restoredEnvs)]),
  ].filter((env) => (liveEnvs[env] ?? "") !== (restoredEnvs[env] ?? ""));

  return {
    changedEnvironments,
    restoredProject: restored.project,
    unresolvedOps: hasUnappliablePatchOps(target.proposedChanges),
  };
};

/**
 * Derive what a constant revision changes, for approval scoping: whether the
 * generic `value` changed (affects all environments), which per-environment
 * overrides changed, and whether the change is metadata-only. Feeds
 * `constantRequiresReview`, which mirrors the feature review model.
 */
export const getConstantRevisionChange = (
  snapshot: Pick<ConstantInterface, "value" | "environmentValues">,
  proposedChanges: JsonPatchOperation[] | unknown,
): {
  valueChanged: boolean;
  changedEnvironments: string[];
  metadataOnly: boolean;
} => {
  const ops = normalizeProposedChanges(proposedChanges);
  const patched = applyTopLevelPatchOps(
    snapshot as unknown as Record<string, unknown>,
    ops,
  ) as Pick<ConstantInterface, "value" | "environmentValues">;

  // Config-only content fields that change what the SDK resolves, so they need
  // full review when approval is enabled rather than metadata-only treatment:
  // `schema` (field definitions) plus the lineage/extensibility fields, which
  // shift the effective resolved value. Constants never carry these ops, so
  // this is a no-op for them.
  const contentChanged = ops.some((op) =>
    CONFIG_CONTENT_FIELDS.has(op.path.split("/")[1]),
  );
  // Deep-equal, not `!==`: a constant's value is a string, but a config reuses
  // this helper with an OBJECT value, where reference-inequality would flag a
  // restated-but-unchanged value as a change (spuriously forcing review).
  //
  // An op this applier can't account for reads as a base-value change — the
  // widest thing it could be. Otherwise a change it dropped lands as
  // `valueChanged: false` with no environments named, which is exactly the shape
  // `constantRequiresReview` treats as "nothing to review".
  const valueChanged =
    !isEqual(snapshot.value ?? "", patched.value ?? "") ||
    contentChanged ||
    hasUnappliablePatchOps(ops);

  const oldEnvs = snapshot.environmentValues ?? {};
  const newEnvs = patched.environmentValues ?? {};
  const changedEnvironments = Array.from(
    new Set([...Object.keys(oldEnvs), ...Object.keys(newEnvs)]),
  ).filter((env) => (oldEnvs[env] ?? "") !== (newEnvs[env] ?? ""));

  return {
    valueChanged,
    changedEnvironments,
    metadataOnly: isConstantRevisionMetadataOnly(ops),
  };
};

/**
 * Whether self-approval is blocked for this revision's entity, read from the
 * correct config source: constants use the feature `requireReviews` model
 * (matched on the constant's project); other entities use `approvalFlows`.
 */
const isSelfApprovalBlockedForEntity = (
  settings: OrganizationSettings | undefined,
  entityType: RevisionTargetType,
  revision: Pick<Revision, "target">,
): boolean => {
  const snapshot = revision.target.snapshot as {
    project?: string;
    projects?: string[];
  };
  if (entityType === "constant" || entityType === "config") {
    return constantBlockSelfApproval({ project: snapshot.project }, settings);
  }
  return !!getApprovalFlowSettings(
    settings?.approvalFlows,
    entityType,
    // Via the shared resolver so composite snapshots (SDK connections) yield
    // their nested scope rather than an empty list.
    entityProjects(snapshot),
  )?.blockSelfApproval;
};

/**
 * Returns true when `userId` contributed to the revision and the entity-type's
 * `blockSelfApproval` setting is enabled — meaning the user must NOT be allowed
 * to approve.
 *
 * Legacy revisions written before `contributors` existed fall back to
 * `[authorId]`, so the existing author-self-review guard remains the only
 * effective gate for them.
 */
export const isUserBlockedFromApproving = ({
  settings,
  entityType,
  revision,
  userId,
}: {
  settings: OrganizationSettings | undefined;
  entityType: RevisionTargetType;
  revision: Pick<Revision, "authorId" | "contributors" | "target">;
  userId: string;
}): boolean => {
  if (!isSelfApprovalBlockedForEntity(settings, entityType, revision)) {
    return false;
  }
  const contributors = revision.contributors ?? [revision.authorId];
  return contributors.includes(userId);
};

export const isAutopublishOnApprovalEnabled = (
  settings: OrganizationSettings | undefined,
  entityType: RevisionTargetType,
  // Both families match their rules on this.
  projects: string[] = [],
): boolean => {
  if (entityType === "constant" || entityType === "config") {
    return constantAutopublishOnApproval({ project: projects[0] }, settings);
  }
  return !!getApprovalFlowSettings(
    settings?.approvalFlows,
    entityType,
    projects,
  )?.autopublishOnApproval;
};

/**
 * Map entity types to a key used for logging/identification.
 *
 * Extension point: add a new `case` here when introducing a new RevisionTargetType.
 * The return value is used as the audit-log / URL segment for the entity.
 */
export const getRevisionKey = (
  entityType: RevisionTargetType,
): string | null => {
  switch (entityType) {
    case "saved-group":
      return "saved-groups";
    case "sdk-connection":
      return "sdk-connections";
    case "constant":
      return "constants";
    case "config":
      return "configs";
    // case "feature": return "features";  ← add future entity types here
    default:
      return null;
  }
};

/**
 * Check if a user can review (approve/request-changes) a revision.
 *
 * For saved-group: anyone who can edit can review (except the author)
 * For managedBy: "team" → user must be on teamOwner team (and not the author)
 * For managedBy: "admin" → user must have manageOfficialResources (and not the author)
 */
export const canUserReviewEntity = ({
  entityType,
  revision,
  entity,
  userId,
  teams,
  userPermissions,
  canEditEntity,
}: {
  entityType: RevisionTargetType;
  revision: Revision;
  entity: RevisionEntity | Record<string, unknown>;
  approvalFlowSettings: ApprovalFlowConfigurations | undefined;
  userId: string;
  teams?: TeamInterface[];
  userPermissions?: Record<string, boolean>;
  canEditEntity?: boolean;
}): boolean => {
  // Can't review merged/discarded revisions or own changes
  if (
    revision.status === "merged" ||
    revision.status === "discarded" ||
    revision.authorId === userId
  ) {
    return false;
  }

  // Extension point: add a new `case` here when introducing a new RevisionTargetType
  // that requires custom reviewer logic beyond the default `canEditEntity` check.
  if (
    entityType === "saved-group" ||
    entityType === "constant" ||
    entityType === "config"
  ) {
    // Anyone who can edit can review (except the author, checked above)
    return !!canEditEntity;
  }
  // case "feature": return !!canEditEntity;  ← add future entity types here

  // Legacy team/admin logic for other entity types (FactMetric, FactTable)
  const typedEntity = entity as RevisionEntity;
  const ops = normalizeProposedChanges(revision.target.proposedChanges);
  const findOpValue = (path: string): unknown => {
    const found = ops
      .slice()
      .reverse()
      .find(
        (op) => op.path === path && (op.op === "replace" || op.op === "add"),
      );
    return found && (found.op === "replace" || found.op === "add")
      ? found.value
      : undefined;
  };
  const proposedManagedBy = findOpValue("/managedBy") as string | undefined;
  const managedBy = proposedManagedBy ?? typedEntity.managedBy;
  const proposedOwnerTeam = findOpValue("/ownerTeam") as string | undefined;
  const ownerTeamId = proposedOwnerTeam ?? typedEntity.ownerTeam;

  if (managedBy === "team") {
    if (ownerTeamId && teams) {
      const ownerTeam = teams.find((t) => t.id === ownerTeamId);
      return ownerTeam?.members?.includes(userId) ?? false;
    }
    return false;
  }

  if (managedBy === "admin") {
    return !!userPermissions?.manageOfficialResources;
  }

  return false;
};

/**
 * Normalise a `proposedChanges` value from the database.
 * Old revisions stored a plain object; new ones store a JsonPatchOperation[].
 * Always returns an array so callers don't have to guard individually.
 */
export function normalizeProposedChanges(
  proposedChanges: unknown,
): JsonPatchOperation[] {
  return Array.isArray(proposedChanges)
    ? (proposedChanges as JsonPatchOperation[])
    : [];
}

function topLevelField(path: string): string | null {
  const parts = path.split("/");
  return parts.length === 2 && parts[1] ? parts[1] : null;
}

/**
 * Detects operations the lightweight top-level applier cannot represent.
 * Callers widen authority and approval scope for legacy nested operations.
 */
export function hasUnappliablePatchOps(proposedChanges: unknown): boolean {
  return normalizeProposedChanges(proposedChanges).some(
    (op) => topLevelField(op.path) === null,
  );
}

/**
 * Applies top-level add, replace, and remove operations. Nested paths are ignored.
 */
export function applyTopLevelPatchOps<T extends Record<string, unknown>>(
  snapshot: T,
  proposedChanges: unknown,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return snapshot;
  const result: Record<string, unknown> = { ...snapshot };
  for (const op of ops) {
    const field = topLevelField(op.path);
    if (field === null) continue;
    if (op.op === "replace" || op.op === "add") {
      result[field] = op.value;
    } else if (op.op === "remove") {
      delete result[field];
    }
  }
  return result as T;
}

/**
 * Extract the changed fields from a JSON Patch operations array as a plain
 * partial object `{ fieldName: proposedValue }`.
 *
 * Useful when calling code that still expects `Partial<T>` (e.g. autoMerge helpers).
 * Old-format (plain object) data is returned unchanged as a Partial<T>.
 */
export function patchOpsToPartial<T extends Record<string, unknown>>(
  proposedChanges: JsonPatchOperation[] | unknown,
): Partial<T> {
  // Backward-compat: if it's already a plain object (old DB format), return as-is
  if (
    proposedChanges !== null &&
    typeof proposedChanges === "object" &&
    !Array.isArray(proposedChanges)
  ) {
    return proposedChanges as Partial<T>;
  }
  const ops = normalizeProposedChanges(proposedChanges);
  const result: Record<string, unknown> = {};
  for (const op of ops) {
    const parts = op.path.split("/");
    if (parts.length !== 2 || !parts[1]) continue;
    const field = parts[1];
    if (op.op === "replace" || op.op === "add") {
      result[field] = op.value;
    } else if (op.op === "remove") {
      result[field] = undefined;
    }
  }
  return result as Partial<T>;
}

/**
 * Check for merge conflicts on-the-fly.
 * Accepts a JSON Patch (RFC 6902) operations array representing the proposed changes.
 * Only fields that were actually changed by the user are checked.
 * If the proposed value equals the base value, it's not considered a change
 * and won't trigger a conflict even if live has changed.
 */
// The top-level fields a revision merge may write for each entity type — the
// keys of the entity's `*UpdatableFieldsSchema`. Pass to `checkMergeConflicts`
// so only mergeable fields participate in conflict detection, on the client
// (conflict UI computes it in the browser) as well as the server. Mirrors each
// back-end adapter's getUpdatableFields(); both read the same pick schema, so
// they can't drift. Exhaustive over RevisionTargetType (no default) so a new
// entity type fails type-check until it's handled here.
export function getRevisionUpdatableFields(
  entityType: RevisionTargetType,
): ReadonlySet<string> {
  switch (entityType) {
    case "config":
      return new Set(Object.keys(configUpdatableFieldsSchema.shape));
    case "constant":
      return new Set(Object.keys(constantUpdatableFieldsSchema.shape));
    case "saved-group":
      return new Set(Object.keys(savedGroupUpdatableFieldsSchema.shape));
    // The SDK-connection snapshot is composite, so its proposed changes target
    // the two top-level branches rather than individual connection fields.
    case "sdk-connection":
      return new Set(["sdkConnection", "sdkWebhooks"]);
  }
}

export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: JsonPatchOperation[] | unknown,
  // The fields the entity's merge can actually write. Only these participate in
  // conflict detection — mirroring `buildMergeDesiredState`, which drops ops for
  // non-updatable fields before merging. If a draft's proposedChanges carry an op
  // for a field that isn't revision-updatable (e.g. one excluded from the
  // snapshot, like a config's `scopedOverrides`, which writes directly to the
  // entity rather than through a revision), without this filter that op reads as
  // a phantom conflict the merge would never apply. Omit to consider every field.
  updatableFields?: ReadonlySet<string>,
): MergeResult {
  // Normalise: old DB documents may have a plain object instead of an array
  const ops = normalizeProposedChanges(proposedChanges);

  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  // Undefined means absent; null is an explicit clear and participates in comparison.
  const hasChanged = (val1: unknown, val2: unknown): boolean => {
    if (val1 === undefined) return false;
    if ((val2 ?? null) === null) return (val1 ?? null) !== null;
    return !isEqual(val1, val2);
  };

  // Extract the top-level field name from a JSON Pointer path (e.g. "/values" → "values",
  // "/values/0" → "values"). The leading "/" is stripped and we take the first segment.
  const fieldFromPath = (path: string): string | null => {
    const segments = path.split("/");
    return segments[1] ?? null;
  };

  // Build a map of top-level field → proposed value.
  // Later ops for the same field win (last-write wins per field).
  const proposedByField = new Map<string, unknown>();
  for (const op of ops) {
    const field = fieldFromPath(op.path);
    if (!field) continue;
    // A non-updatable field can't be merged, so it can't truly conflict —
    // ignore its ops (see `updatableFields` above).
    if (updatableFields && !updatableFields.has(field)) continue;
    if (op.op === "replace" || op.op === "add") {
      proposedByField.set(field, op.value);
    } else if (op.op === "remove") {
      proposedByField.set(field, undefined);
    }
  }

  for (const [field, proposedValue] of proposedByField) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];

    // Skip if no effective change from base
    const proposedChanged = hasChanged(proposedValue, baseValue);
    if (!proposedChanged) continue;

    const liveChanged = hasChanged(liveValue, baseValue);

    if (liveChanged && proposedChanged) {
      if (hasChanged(proposedValue, liveValue)) {
        conflicts.push({ field, baseValue, liveValue, proposedValue });
      } else {
        // Both changed to the same value — no conflict
        fieldsChanged.push(field);
      }
    } else if (proposedChanged) {
      mergedChanges[field] = proposedValue;
      fieldsChanged.push(field);
    }
  }

  return {
    success: conflicts.length === 0,
    conflicts,
    canAutoMerge: conflicts.length === 0,
    fieldsChanged,
    mergedChanges: conflicts.length === 0 ? mergedChanges : undefined,
  };
}

// ── Revision display helpers ─────────────────────────────────────────────────
// Shared by the revision dropdown, the revert modal, and the entity pages so the
// "which revision is live" rule and the display version-number fallback can't
// drift between surfaces.

const byDateCreatedAsc = <T extends Pick<Revision, "dateCreated">>(
  a: T,
  b: T,
): number =>
  new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime();

/**
 * The "live" revision is the most-recently-published (merged) one. Returns
 * `undefined` when nothing has been published yet.
 */
export function getLiveRevision<
  T extends Pick<Revision, "status" | "dateUpdated">,
>(revisions: T[]): T | undefined {
  return [...revisions]
    .filter((r) => r.status === "merged")
    .sort(
      (a, b) =>
        new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
    )[0];
}

/**
 * Display version number for a single revision: the stored `version` when
 * present, otherwise its 1-based position by creation date (for legacy
 * revisions saved before `version` existed). When `revision` is undefined
 * (e.g. "live" with no published revision yet) returns the total count.
 */
export function getRevisionNumber<
  T extends Pick<Revision, "id" | "version" | "dateCreated">,
>(revisions: T[], revision: T | undefined): number {
  if ((revision?.version ?? null) !== null) return revision!.version as number;
  const sorted = [...revisions].sort(byDateCreatedAsc);
  if (revision) return sorted.findIndex((r) => r.id === revision.id) + 1;
  return sorted.length;
}

/**
 * Map of revision id → display version number (see `getRevisionNumber`).
 * Builds the creation-date sort once for the whole set.
 */
export function getRevisionNumberById<
  T extends Pick<Revision, "id" | "version" | "dateCreated">,
>(revisions: T[]): Map<string, number> {
  const sorted = [...revisions].sort(byDateCreatedAsc);
  return new Map<string, number>(
    revisions.map((r) => [
      r.id,
      r.version ?? sorted.findIndex((s) => s.id === r.id) + 1,
    ]),
  );
}

// Matches the feature revision shape.
export type ReviewerVerdictStatus =
  | "approved"
  | "changes-requested"
  | "approved-stale"
  | "changes-requested-stale";

const VERDICT_BASE: Record<string, "approved" | "changes-requested"> = {
  approve: "approved",
  "request-changes": "changes-requested",
};

// As hooks see them: latest per reviewer, `decision` + `stale` collapsed.
export function toHookReviewerVerdicts<U, T>(
  reviews: {
    userId: string;
    decision: string;
    stale?: boolean;
    dateCreated: Date;
  }[],
  enrich: (userId: string) => { user: U; teams: T[] },
): {
  userId: string;
  user: U;
  status: ReviewerVerdictStatus;
  timestamp: Date;
  teams: T[];
}[] {
  const latest = new Map<
    string,
    { status: ReviewerVerdictStatus; timestamp: Date }
  >();
  for (const r of reviews) {
    const base = VERDICT_BASE[r.decision];
    if (!base) continue;
    const status = (r.stale ? `${base}-stale` : base) as ReviewerVerdictStatus;
    const existing = latest.get(r.userId);
    if (existing && existing.timestamp > r.dateCreated) continue;
    latest.set(r.userId, { status, timestamp: r.dateCreated });
  }
  return Array.from(latest, ([userId, v]) => ({
    userId,
    ...enrich(userId),
    status: v.status,
    timestamp: v.timestamp,
  }));
}

// `contributors` may include the author, and carries blanks from older rows.
export function coauthorIds(
  authorId: string | undefined,
  contributors: string[] | undefined,
): string[] {
  return (contributors ?? []).filter((id) => !!id && id !== authorId);
}

/**
 * Returns true when the only change in the revision is the SDK-connection
 * display name (the sole "metadata" field). Almost every other field affects
 * the generated payload, so only the name is exempt. Archiving and webhook
 * changes are intentionally excluded — they always require review when
 * approval is enabled.
 *
 * With the nested snapshot structure, connection settings are stored as a
 * coarse `replace /sdkConnection` patch containing the entire new settings
 * object. To determine which fields actually changed we compare against the
 * `baselineSnapshot.sdkConnection` supplied by the caller (both the adapter
 * and the frontend have the revision's snapshot available). Without a
 * baseline we conservatively return `false` (require review).
 */
export const isSdkConnectionRevisionMetadataOnly = (
  proposedChanges: JsonPatchOperation[] | unknown,
  baselineSnapshot?: Record<string, unknown>,
): boolean => {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return false;

  // Any webhook op means something more than metadata changed.
  if (ops.some((op) => op.path === "/sdkWebhooks")) return false;

  // Expect exactly one `replace /sdkConnection` op.
  const connOp = ops.find(
    (op) => op.path === "/sdkConnection" && op.op === "replace",
  );
  if (!connOp || ops.length > 1) return false;

  // Need the baseline settings object to know which fields changed.
  const baseline = baselineSnapshot?.["sdkConnection"] as
    | Record<string, unknown>
    | undefined;
  if (!baseline) return false;

  const proposed = ("value" in connOp ? connOp.value : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
    return false;
  }

  // Metadata-only if every field is identical to the baseline except `name`
  // and system-managed fields (`dateUpdated`, `dateCreated`).
  const skipKeys = new Set(["name", "dateUpdated", "dateCreated"]);
  const allKeys = new Set([...Object.keys(proposed), ...Object.keys(baseline)]);
  for (const key of allKeys) {
    if (skipKeys.has(key)) continue;
    if (!isEqual(proposed[key], baseline[key])) return false;
  }
  // Require the name to have actually changed (otherwise zero real changes).
  return !isEqual(proposed["name"], baseline["name"]);
};

// ---------------------------------------------------------------------------
// SDK-connection approval scoping (project + environment, SDK-connection only)
//
// Mirrors how Features scope `requireReviews`: each rule carries optional
// `projects` / `environments` arrays. A rule applies to a connection when the
// connection's project(s) match the rule's `projects` (empty = all projects)
// AND its environment matches the rule's `environments` (empty = all
// environments). Multiple rules OR together. Saved groups and features do NOT
// use these helpers.
// ---------------------------------------------------------------------------

export type SdkConnectionApprovalScope = {
  projects?: string[];
  environment?: string;
};

/**
 * Whether an approval rule's project/environment scope matches a connection.
 * An empty (or omitted) `projects`/`environments` on the rule means "all".
 * Mirrors the feature `getReviewSetting` (project) + `checkEnvironmentsMatch`
 * (environment) logic, extended to a connection's `projects` array.
 */
export const sdkConnectionMatchesApprovalScope = (
  rule: Pick<ApprovalFlowConfiguration, "projects" | "environments">,
  scope: SdkConnectionApprovalScope,
): boolean => {
  const ruleProjects = rule.projects ?? [];
  const connProjects = scope.projects ?? [];
  const projectMatch =
    ruleProjects.length === 0 ||
    connProjects.some((p) => ruleProjects.includes(p));

  const ruleEnvironments = rule.environments ?? [];
  const envMatch =
    ruleEnvironments.length === 0 ||
    (!!scope.environment && ruleEnvironments.includes(scope.environment));

  return projectMatch && envMatch;
};

/**
 * The first enabled SDK-connection approval rule whose project/environment
 * scope matches the given connection, or undefined if none require approval for
 * it. The matched rule supplies the per-rule settings (requireMetadataReview, etc.).
 */
export const getSdkConnectionApprovalRule = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
  scope: SdkConnectionApprovalScope,
): ApprovalFlowConfiguration | undefined => {
  const rules = approvalFlows?.sdkConnections;
  if (!rules?.length) return undefined;
  return rules.find(
    (rule) => rule.required && sdkConnectionMatchesApprovalScope(rule, scope),
  );
};

/**
 * Whether the org has *any* enabled SDK-connection approval rule (ignoring
 * scope). Used for type-level "does this org use SDK-connection approvals at
 * all" decisions, e.g. the approvals inbox / badge query.
 */
export const orgHasAnySdkConnectionApproval = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
): boolean => !!approvalFlows?.sdkConnections?.some((rule) => rule.required);
