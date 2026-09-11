import { ExposureQuery } from "shared/types/datasource";

type ExposureQueryIdentity = Pick<
  ExposureQuery,
  "id" | "userIdType" | "userIdTypes"
>;

function firstIdentifierType(query: ExposureQueryIdentity): string {
  return query.userIdTypes?.[0] ?? query.userIdType;
}

/**
 * Assignment queries whose *first* identifier type changed between two settings
 * revisions — removed, or reordered so a different type is first. The first
 * identifier is what experiments configured before multi-identifier support
 * implicitly analyze on, so a change repoints them. Callers pin dependent legacy
 * experiments to `previousIdentifierType` to preserve their analysis unit.
 * Queries added or deleted between revisions are ignored (nothing to pin).
 */
export function getExposureQueriesWithChangedBaseIdentifier(
  previous: ExposureQueryIdentity[],
  next: ExposureQueryIdentity[],
): { id: string; previousIdentifierType: string }[] {
  const previousById = new Map(previous.map((q) => [q.id, q]));
  const changed: { id: string; previousIdentifierType: string }[] = [];
  for (const nextQuery of next) {
    const previousQuery = previousById.get(nextQuery.id);
    if (!previousQuery) continue;
    const previousFirst = firstIdentifierType(previousQuery);
    const nextFirst = firstIdentifierType(nextQuery);
    if (previousFirst && nextFirst && previousFirst !== nextFirst) {
      changed.push({ id: nextQuery.id, previousIdentifierType: previousFirst });
    }
  }
  return changed;
}
