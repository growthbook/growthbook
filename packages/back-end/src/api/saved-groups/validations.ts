import {
  ID_LIST_DATATYPES,
  validateCondition,
  formatByteSizeString,
  SAVED_GROUP_SIZE_LIMIT_BYTES,
} from "shared/util";
import type { SavedGroupInterface } from "shared/types/saved-group";
import {
  Revision,
  RevisionStatus,
  normalizeProposedChanges,
} from "shared/enterprise";
import { ApiReqContext } from "back-end/types/api";
import {
  applyPatchToSnapshot,
  createOrUpdateRevision,
  ensureLiveRevisionExists,
} from "back-end/src/revisions/util";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

// Open statuses (i.e. editable, non-terminal). Mirrors `ACTIVE_DRAFT_STATUSES`
// in features/validations.ts, but typed off the saved-group revision enum
// since the feature and saved-group revision status enums are distinct.
export const ACTIVE_STATUSES: readonly RevisionStatus[] = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

/**
 * True iff the revision is in a status that allows further edits. Mirrors
 * `isDraftStatus` from features/validations.ts.
 */
export function isDraftStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * Build a fresh draft revision for a saved group. Used when callers pass
 * `version: "new"` to a field-edit endpoint and we need to auto-create the
 * draft they intend to edit.
 *
 * Pairs with `discardIfJustCreated` — call that on any downstream failure to
 * avoid leaving an orphaned empty draft behind.
 */
async function createBlankDraft(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
  options: { title?: string; comment?: string } = {},
): Promise<Revision> {
  await ensureLiveRevisionExists(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & {
      id: string;
      owner?: string;
      dateCreated?: Date;
    },
  );

  return createOrUpdateRevision(
    context,
    "saved-group",
    savedGroup as unknown as Record<string, unknown> & { id: string },
    [],
    {
      forceCreate: true,
      title: options.title,
      comment: options.comment,
    },
  );
}

/**
 * Look up a revision by version, scoped to the supplied saved group. Throws
 * `NotFoundError` if no such revision exists. The `target.id`/`target.type`
 * scoping prevents callers from peeking at revisions belonging to other
 * entities — the `getByTargetAndVersion` helper enforces this on the model
 * side as well, but we double-check here so a stale path-param can never
 * accidentally surface a different entity's revision.
 */
export async function loadRevisionByVersion(
  context: ApiReqContext,
  savedGroupId: string,
  version: number,
): Promise<Revision> {
  const revision = await context.models.revisions.getByTargetAndVersion(
    "saved-group",
    savedGroupId,
    version,
  );
  if (!revision) {
    throw new NotFoundError("Could not find saved group revision");
  }
  if (
    revision.target.type !== "saved-group" ||
    revision.target.id !== savedGroupId
  ) {
    throw new NotFoundError("Could not find saved group revision");
  }
  return revision;
}

/**
 * Resolve a revision pinned to a specific version, or auto-create a fresh
 * draft when `version === "new"`. Mirrors `resolveOrCreateRevision` from
 * features/validations.ts.
 *
 * Returns `{ revision, created }` where `created === true` indicates the
 * revision was just created — pair with `discardIfJustCreated` on downstream
 * failures so we never leave behind an orphaned empty draft.
 */
export async function resolveOrCreateRevision(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
  version: number | "new",
  options: { title?: string; comment?: string } = {},
): Promise<{ revision: Revision; created: boolean }> {
  if (version === "new") {
    const revision = await createBlankDraft(context, savedGroup, options);
    return { revision, created: true };
  }
  const revision = await loadRevisionByVersion(context, savedGroup.id, version);
  return { revision, created: false };
}

/**
 * Best-effort discard of a just-created draft. Never throws so it can't mask
 * the original error from the caller's failed handler. Mirrors
 * `discardIfJustCreated` from features/validations.ts.
 */
export async function discardIfJustCreated(
  context: ApiReqContext,
  revision: Revision,
  created: boolean,
): Promise<void> {
  if (!created) return;
  try {
    await context.models.revisions.close(
      revision.id,
      context.userId,
      "Discarded after error during draft initialization",
    );
  } catch (err) {
    logger.warn(
      {
        err,
        revisionId: revision.id,
        savedGroupId: revision.target.id,
      },
      "Failed to discard orphaned saved-group draft after downstream failure",
    );
  }
}

/**
 * Apply the revision's proposed changes on top of its baseline snapshot.
 * Returns the post-merge view of the saved group — useful for previewing
 * the proposed state and for running validations against it.
 */
export function applyRevisionToSnapshot(
  revision: Revision,
): SavedGroupInterface {
  return applyPatchToSnapshot(
    revision.target.snapshot as SavedGroupInterface,
    normalizeProposedChanges(revision.target.proposedChanges),
  );
}

// ---- Field-level validators (re-used across all field-edit handlers) ----

/**
 * Throws if the saved group's type doesn't permit a list (`values` /
 * `attributeKey`) edit. Centralised so each handler doesn't have to duplicate
 * the same guard with a slightly different error string.
 */
export function assertListGroup(savedGroup: SavedGroupInterface): void {
  if (savedGroup.type !== "list") {
    throw new BadRequestError(
      "This action is only valid for list saved groups",
    );
  }
}

export function assertConditionGroup(savedGroup: SavedGroupInterface): void {
  if (savedGroup.type !== "condition") {
    throw new BadRequestError(
      "This action is only valid for condition saved groups",
    );
  }
}

/**
 * Validates the saved group's `attributeKey` against the org's attribute
 * schema. The internal controller does the same thing inline; centralising
 * keeps the public API in lockstep without copy/paste drift.
 */
export function assertValidListAttributeKey(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
): void {
  const attributeSchema = context.org.settings?.attributeSchema || [];
  const datatype = attributeSchema.find(
    (sdkAttr) => sdkAttr.property === savedGroup.attributeKey,
  )?.datatype;
  if (!datatype) {
    throw new BadRequestError("Unknown attributeKey");
  }
  if (!ID_LIST_DATATYPES.includes(datatype)) {
    throw new BadRequestError(
      "Cannot modify items on this group. The attribute key's datatype is not supported.",
    );
  }
}

/**
 * Validates the values list against the org's saved-group size limit. Mirrors
 * `validateListSize` from the internal controller. Re-implemented locally so
 * the API handlers don't have to reach into the controller and inherit its
 * `throw new Error(...)` style — public-API errors should be `BadRequestError`
 * so callers get a 400 instead of a 500.
 */
export function validateListSize(
  values: Array<unknown>,
  savedGroupSizeLimit: number | undefined,
  canBypassSizeLimit: boolean,
): void {
  if (
    savedGroupSizeLimit &&
    values.length > savedGroupSizeLimit &&
    !canBypassSizeLimit
  ) {
    throw new BadRequestError(
      `Your organization has imposed a maximum list length of ${savedGroupSizeLimit}`,
    );
  }
  if (new Blob([JSON.stringify(values)]).size > SAVED_GROUP_SIZE_LIMIT_BYTES) {
    throw new BadRequestError(
      `The maximum size for a list is ${formatByteSizeString(
        SAVED_GROUP_SIZE_LIMIT_BYTES,
      )}.`,
    );
  }
}

/**
 * Validate a condition string against the org's saved-group set, including
 * cycle detection. Used by the `PUT .../condition` field-edit handler.
 */
export async function validateConditionForGroup(
  context: ApiReqContext,
  savedGroup: SavedGroupInterface,
  condition: string,
): Promise<void> {
  const allSavedGroups = await context.models.savedGroups.getAll();
  const groupMap = new Map(allSavedGroups.map((sg) => [sg.id, sg]));
  groupMap.set(savedGroup.id, { ...savedGroup, condition });
  const conditionRes = validateCondition(condition, groupMap);
  if (!conditionRes.success) {
    throw new BadRequestError(conditionRes.error || "Invalid condition");
  }
  if (conditionRes.empty) {
    throw new BadRequestError("Condition cannot be empty");
  }
}

export function assertValidDescription(description: string | undefined): void {
  if (typeof description === "string" && description.length > 100) {
    throw new BadRequestError("Description must be at most 100 characters");
  }
}

/**
 * `mine=true` requires a user-scoped API key so we can identify the caller
 * as a user. A secret API key has no user identity attached, so we'd be
 * forced to either return everything (information leak) or return nothing
 * silently (footgun) — both are bad. Reject up front instead.
 */
export function assertUserScopedKeyForMine(
  context: ApiReqContext,
  mine: boolean,
): void {
  if (mine && !context.userId) {
    throw new BadRequestError(
      "`mine=true` requires a user-scoped API key (the caller must be identifiable as a user).",
    );
  }
}

/**
 * Translate the public `status` query param (which accepts a single status, a
 * comma-separated list, or the literal `"open"` shortcut) into the model's
 * filter shape — `string | string[] | undefined`.
 *
 * The `"open"` alias is passed through as a single string so the model can
 * expand it into its own non-terminal status set (see `buildStatusFilter` on
 * `RevisionModel`).
 */
export function buildRevisionStatusFilter(
  input?: string,
): string | string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes("open")) return "open";
  return parts.length === 1 ? parts[0] : parts;
}

export function dedupeValues(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Helper: when a caller passes a non-self-consistent metadata payload — e.g.
 * `revisionTitle` without any actual content edit — we don't want to silently
 * drop the title. The handlers that auto-create drafts pass these to
 * `resolveOrCreateRevision`, and ones that don't auto-create can ignore them.
 */
export function pickNewDraftMetadata(body: {
  revisionTitle?: string;
  revisionComment?: string;
}): { title?: string; comment?: string } {
  return {
    title: body.revisionTitle,
    comment: body.revisionComment,
  };
}
