import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";

/**
 * Revision helpers shared by the entity API directories.
 *
 * Each of `api/configs`, `api/constants` and `api/saved-groups` carried its own
 * byte-identical copy of these, with nothing entity-specific in any of them. The
 * entity-shaped helpers stay in their own `validations.ts` — those genuinely differ
 * (Configs and Constants load a revision by key, Saved Groups by id).
 */

/**
 * Whether a revision is still open to editing. The canonical list lives in shared;
 * the three local ACTIVE_STATUSES copies restated it verbatim.
 *
 * Feature Flags deliberately keep their own notion (`DRAFT_STATUSES`), so this is
 * for the generic-revision entities.
 */
export function isDraftStatus(status: string): boolean {
  return (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(status);
}

/**
 * `mine=true` filters by the calling user, so it needs a caller who IS a user.
 * An org-scoped API key has no identity to filter on.
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
 * Parse a `status` query parameter into a model filter: a bare `open` sentinel, a
 * single status, or a list.
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
