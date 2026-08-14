import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { revisionStatus } from "shared/enterprise";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";

// Entity-agnostic revision helpers for the API layer. Entity-shaped ones stay in
// each entity's own validations.ts, since those genuinely differ.

// Whether a revision is still open to editing. Feature Flags keep their own notion
// (DRAFT_STATUSES), so this is for the generic-revision entities.
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

// The concrete statuses the `open` alias stands for — every non-terminal one.
// Kept as a derivation rather than a literal list so a new status joins it
// automatically; the model's bare-`open` clause is `$nin: [merged, discarded]`,
// and this must expand to the same set.
const OPEN_ALIAS_STATUSES: string[] = revisionStatus.filter(
  (s: string) => s !== "merged" && s !== "discarded",
);

/**
 * Parse a `status` query parameter into a model filter: a bare `open` sentinel, a
 * single status, or a list.
 *
 * `open` mixed with concrete statuses EXPANDS rather than swallowing them.
 * Returning the bare sentinel for `status=open,merged` dropped `merged` on the
 * floor and answered a narrower question than the caller asked — a silent wrong
 * answer, not an error, so a paging client just saw fewer revisions than exist.
 */
export function buildRevisionStatusFilter(
  input?: string,
): string | string[] | undefined {
  if (!input) return undefined;
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  if (parts.includes("open")) {
    // Alone, keep the sentinel: the model turns it into a `$nin`, which also
    // covers any status this list doesn't know about.
    if (parts.length === 1) return "open";
    return [
      ...new Set([
        ...OPEN_ALIAS_STATUSES,
        ...parts.filter((p) => p !== "open"),
      ]),
    ];
  }
  return parts.length === 1 ? parts[0] : [...new Set(parts)];
}
