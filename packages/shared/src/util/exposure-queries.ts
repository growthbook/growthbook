import { ExposureQuery } from "shared/types/datasource";
import { isProjectListValidForProject } from ".";

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
 * For resources spanning several projects (holdouts): the query must be usable
 * by every one of them. No projects means all projects, so only an unscoped
 * query qualifies.
 */
export function isExposureQueryAvailableForProjects(
  query: Pick<ExposureQuery, "projects">,
  projects: string[],
): boolean {
  const scope = query.projects ?? [];
  if (!scope.length) return true;
  if (!projects.length) return false;
  return projects.every((project) => scope.includes(project));
}

/**
 * Validates an assignment query selection before it is saved: the query exists,
 * declares `identifierType` (when given), and is in scope. Scope is either a
 * single `project`, or `projects` that must all be covered (holdouts); pass
 * `project: undefined` without `projects` to skip the scope check.
 */
export function assertValidAssignmentQuerySelection({
  exposureQueries,
  exposureQueryId,
  identifierType,
  project,
  projects,
}: {
  exposureQueries: ExposureQuery[];
  exposureQueryId: string;
  identifierType?: string;
  project: string | undefined;
  projects?: string[];
}): ExposureQuery {
  const query = exposureQueries.find((q) => q.id === exposureQueryId);
  if (!query) {
    throw new Error(`Unrecognized assignment query ID: ${exposureQueryId}`);
  }
  if (
    identifierType &&
    !getExposureQueryIdentifierTypes(query).includes(identifierType)
  ) {
    throw new Error(
      `Identifier type "${identifierType}" is not declared by assignment query "${exposureQueryId}"`,
    );
  }
  if (projects) {
    if (!isExposureQueryAvailableForProjects(query, projects)) {
      throw new Error(
        projects.length
          ? `Assignment query "${exposureQueryId}" is not available for every project this holdout covers (${projects.join(", ")})`
          : `Assignment query "${exposureQueryId}" is scoped to specific projects, so it can't be used by a holdout that covers all projects`,
      );
    }
  } else if (
    project !== undefined &&
    !isProjectListValidForProject(query.projects, project)
  ) {
    throw new Error(
      `Assignment query "${exposureQueryId}" is not available for project "${project}"`,
    );
  }
  return query;
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
