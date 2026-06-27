import { validateResolvableValue } from "shared/validators";
import type { ConstantInterface } from "shared/types/constant";
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

// Open (editable, non-terminal) statuses — mirrors the saved-group helper.
export const ACTIVE_STATUSES: readonly RevisionStatus[] = [
  "draft",
  "pending-review",
  "approved",
  "changes-requested",
];

export function isDraftStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

// The loosely-typed entity shape the revision helpers expect.
type RevisionEntityArg = Record<string, unknown> & {
  id: string;
  owner?: string;
  dateCreated?: Date;
};

async function createBlankDraft(
  context: ApiReqContext,
  constant: ConstantInterface,
  options: { title?: string; comment?: string } = {},
): Promise<Revision> {
  await ensureLiveRevisionExists(
    context,
    "constant",
    constant as unknown as RevisionEntityArg,
  );
  return createOrUpdateRevision(
    context,
    "constant",
    constant as unknown as Record<string, unknown> & { id: string },
    [],
    { forceCreate: true, title: options.title, comment: options.comment },
  );
}

// Look up a revision by version, scoped to the supplied constant.
export async function loadRevisionByVersion(
  context: ApiReqContext,
  constantId: string,
  version: number,
): Promise<Revision> {
  const revision = await context.models.revisions.getByTargetAndVersion(
    "constant",
    constantId,
    version,
  );
  if (
    !revision ||
    revision.target.type !== "constant" ||
    revision.target.id !== constantId
  ) {
    throw new NotFoundError("Could not find constant revision");
  }
  return revision;
}

// Resolve a pinned version, or auto-create a fresh draft when version === "new".
export async function resolveOrCreateRevision(
  context: ApiReqContext,
  constant: ConstantInterface,
  version: number | "new",
  options: { title?: string; comment?: string } = {},
): Promise<{ revision: Revision; created: boolean }> {
  if (version === "new") {
    const revision = await createBlankDraft(context, constant, options);
    return { revision, created: true };
  }
  const revision = await loadRevisionByVersion(context, constant.id, version);
  return { revision, created: false };
}

// Best-effort discard of a just-created draft. Never throws.
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
      { err, revisionId: revision.id, constantId: revision.target.id },
      "Failed to discard orphaned constant draft after downstream failure",
    );
  }
}

export function applyRevisionToSnapshot(revision: Revision): ConstantInterface {
  return applyPatchToSnapshot(
    revision.target.snapshot as ConstantInterface,
    normalizeProposedChanges(revision.target.proposedChanges),
  ) as ConstantInterface;
}

// `mine=true` requires a user-scoped key so the caller is identifiable.
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

// Translate the public `status` query param into the model's filter shape.
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

export function pickNewDraftMetadata(body: {
  revisionTitle?: string;
  revisionComment?: string;
}): { title?: string; comment?: string } {
  return { title: body.revisionTitle, comment: body.revisionComment };
}

// Validate a staged value/environmentValues edit against the constant's type
// (valid JSON for `json` constants; empty allowed). Throws BadRequestError.
export function assertValidConstantValueEdit(
  constant: ConstantInterface,
  value: string | undefined,
  environmentValues: Record<string, string> | undefined,
): void {
  try {
    if (value !== undefined)
      validateResolvableValue({
        type: constant.type,
        value,
        label: "value",
        refSource: "constant",
      });
    for (const [env, v] of Object.entries(environmentValues ?? {})) {
      validateResolvableValue({
        type: constant.type,
        value: v,
        label: env,
        refSource: "constant",
      });
    }
  } catch (e) {
    throw new BadRequestError(e instanceof Error ? e.message : String(e));
  }
}
