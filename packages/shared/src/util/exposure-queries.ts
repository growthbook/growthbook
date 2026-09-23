import { ExposureQuery } from "shared/types/datasource";

type ExposureQueryIdentity = Pick<
  ExposureQuery,
  "id" | "userIdType" | "userIdTypes"
>;

// Falls back to the deprecated scalar for queries saved before userIdTypes.
export function getExposureQueryIdentifierTypes(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
): string[] {
  return query.userIdTypes?.length
    ? query.userIdTypes
    : [query.userIdType].filter(Boolean);
}

/**
 * The identifier an analysis runs on: the stored one, or the query's first when
 * none is stored. Null when the stored one is no longer declared, since
 * analysis refuses to run on it.
 */
export function resolveExposureQueryIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
  storedIdentifierType: string | undefined,
): string | null {
  const identifierTypes = getExposureQueryIdentifierTypes(query);
  if (!storedIdentifierType) return identifierTypes[0] ?? null;
  return identifierTypes.includes(storedIdentifierType)
    ? storedIdentifierType
    : null;
}

function firstIdentifierType(query: ExposureQueryIdentity): string {
  return getExposureQueryIdentifierTypes(query)[0] ?? query.userIdType;
}

/**
 * Reads a REST body's grouped assignment query field and its deprecated flat
 * `<field>Id`, which are mutually exclusive.
 */
export function parseAssignmentQueryInput(
  assignmentQuery: { id: string; identifierType: string } | undefined,
  deprecatedId: string | undefined,
  field: "assignmentQuery" | "exposureQuery",
): { id: string | undefined; identifierType: string | undefined } {
  if (assignmentQuery && deprecatedId !== undefined) {
    throw new Error(
      `Cannot set ${field} together with the deprecated ${field}Id`,
    );
  }
  return {
    id: assignmentQuery?.id ?? deprecatedId,
    identifierType: assignmentQuery?.identifierType,
  };
}

/**
 * Throws rather than let analysis run on an identifier the query no longer
 * returns. A missing identifier type falls back to the query's first.
 */
export function assertExposureQueryDeclaresIdentifierType(
  query: ExposureQueryIdentity & Pick<ExposureQuery, "name">,
  identifierType: string | undefined,
): void {
  if (!identifierType) return;
  if (!getExposureQueryIdentifierTypes(query).includes(identifierType)) {
    throw new Error(
      `Identifier type "${identifierType}" is no longer declared by assignment query "${query.name || query.id}". Choose a supported identifier before running analysis.`,
    );
  }
}

/**
 * Queries whose first identifier changed. Legacy experiments analyze on the
 * first identifier, so callers pin them to `previousIdentifierType`.
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
