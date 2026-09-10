import { ExposureQuery } from "shared/types/datasource";

type ExposureQueryIdentity = Pick<
  ExposureQuery,
  "id" | "userIdType" | "userIdTypes"
>;

function firstIdentifierType(query: ExposureQueryIdentity): string {
  return query.userIdTypes?.[0] ?? query.userIdType;
}

/**
 * Queries whose first identifier type changed — the one experiments configured
 * before multi-identifier support implicitly analyze on. Callers pin dependent
 * legacy experiments to `previousIdentifierType` so they don't silently repoint.
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

/**
 * Queries that violate `EAQ.projects ⊆ datasource.projects`. Empty
 * `datasourceProjects` means all projects (nothing out of scope); a query with no
 * projects inherits the data source scope.
 */
export function getExposureQueriesOutsideProjectScope(
  exposureQueries: Pick<ExposureQuery, "id" | "name" | "projects">[],
  datasourceProjects: string[],
): { id: string; name: string; invalidProjects: string[] }[] {
  if (!datasourceProjects.length) return [];
  const allowed = new Set(datasourceProjects);
  const violations: { id: string; name: string; invalidProjects: string[] }[] =
    [];
  for (const query of exposureQueries) {
    const invalidProjects = (query.projects ?? []).filter(
      (project) => !allowed.has(project),
    );
    if (invalidProjects.length) {
      violations.push({ id: query.id, name: query.name, invalidProjects });
    }
  }
  return violations;
}
