import { ExposureQuery } from "shared/types/datasource";
import { ResolvedExposureQuery } from "shared/types/integrations";
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
 * The identifier a saved record analyzes on: the stored one, even if its query
 * no longer declares it (analysis then refuses to run), else the query's frozen
 * legacy identifier (`userIdType`). A new record defaults to `userIdTypes[0]`
 * instead, so don't use this to pick one.
 */
export function getAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
  storedIdentifierType: string | undefined,
): string;
export function getAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes"> | undefined,
  storedIdentifierType: string | undefined,
): string | undefined;
export function getAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes"> | undefined,
  storedIdentifierType: string | undefined,
): string | undefined {
  if (storedIdentifierType) return storedIdentifierType;
  return query
    ? query.userIdType || getExposureQueryIdentifierTypes(query)[0] || ""
    : undefined;
}

/**
 * Reads a REST body's grouped assignment query field and its deprecated flat
 * `<field>Id`, which are mutually exclusive.
 */
export function parseAssignmentQueryInput(
  assignmentQuery: { id: string; identifierType?: string } | undefined,
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
 * Maps a REST body's grouped `exposureQuery` onto the stored flat
 * `exposureQueryId` / `exposureQueryIdentifierType`, keeping every other field.
 * Keys are only set when given, so partial update bodies stay partial.
 */
export function flattenExposureQueryInput<
  T extends {
    exposureQuery?: { id: string; identifierType?: string };
    exposureQueryId?: string;
  },
>(
  body: T,
): Omit<T, "exposureQuery"> & {
  exposureQueryId?: string;
  exposureQueryIdentifierType?: string;
} {
  const { exposureQuery, ...rest } = body;
  const { id, identifierType } = parseAssignmentQueryInput(
    exposureQuery,
    body.exposureQueryId,
    "exposureQuery",
  );
  return {
    ...rest,
    ...(id !== undefined ? { exposureQueryId: id } : {}),
    ...(identifierType ? { exposureQueryIdentifierType: identifierType } : {}),
  };
}

/**
 * A REST ref may omit `identifierType` unless it selects a different query that
 * declares several, where the choice would be ambiguous. Keeping the current
 * query keeps its identifier.
 */
export function assertAssignmentQueryRefIdentifierType({
  ref,
  field,
  exposureQueries,
  currentExposureQueryId,
}: {
  ref: { id: string; identifierType?: string } | undefined;
  field: "assignmentQuery" | "exposureQuery";
  exposureQueries: Pick<
    ExposureQuery,
    "id" | "name" | "userIdType" | "userIdTypes"
  >[];
  currentExposureQueryId: string | undefined;
}): void {
  if (!ref || ref.identifierType || ref.id === currentExposureQueryId) return;
  const query = exposureQueries.find((q) => q.id === ref.id);
  if (!query) return;
  const identifierTypes = getExposureQueryIdentifierTypes(query);
  if (identifierTypes.length > 1) {
    throw new Error(
      `Assignment query "${query.name || query.id}" declares several identifier types (${identifierTypes.join(", ")}). Set ${field}.identifierType to choose one.`,
    );
  }
}

/**
 * For resources spanning several projects (holdouts): the query must be usable
 * by every one of them. A query with no projects inherits its data source's,
 * and no projects on either means all. A holdout with no projects covers all
 * projects, so only an unrestricted query qualifies.
 */
export function isExposureQueryAvailableForProjects(
  query: Pick<ExposureQuery, "projects">,
  projects: string[],
  datasourceProjects: string[] | undefined,
): boolean {
  const scope = query.projects?.length
    ? query.projects
    : (datasourceProjects ?? []);
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
  datasourceProjects,
}: {
  exposureQueries: ExposureQuery[];
  exposureQueryId: string;
  identifierType?: string;
  project: string | undefined;
  projects?: string[];
  // Inherited by queries without their own project scope (holdout check).
  datasourceProjects?: string[];
}): ExposureQuery {
  const query = exposureQueries.find((q) => q.id === exposureQueryId);
  if (!query) {
    throw new Error(
      `Assignment query "${exposureQueryId}" doesn't exist on this data source`,
    );
  }
  const name = query.name || query.id;
  if (
    identifierType &&
    !getExposureQueryIdentifierTypes(query).includes(identifierType)
  ) {
    throw new Error(
      `Assignment query "${name}" doesn't declare the "${identifierType}" identifier type`,
    );
  }
  if (projects) {
    if (
      !isExposureQueryAvailableForProjects(query, projects, datasourceProjects)
    ) {
      const scopeSource = query.projects?.length
        ? "its own"
        : "its data source's";
      throw new Error(
        projects.length
          ? `Assignment query "${name}" isn't available for every project this holdout covers because of ${scopeSource} project scope`
          : `Assignment query "${name}" is limited by ${scopeSource} project scope, so it can't be used by a holdout that covers all projects`,
      );
    }
  } else if (
    project !== undefined &&
    !isProjectListValidForProject(query.projects, project)
  ) {
    throw new Error(
      `Assignment query "${name}" isn't available for the selected project`,
    );
  }
  return query;
}

/**
 * API shape of a stored assignment query selection. Legacy records (no stored
 * identifier) report their query's legacy identifier; omitted when that can't be
 * resolved.
 */
export function toApiAssignmentQueryRef(
  id: string | undefined,
  storedIdentifierType: string | undefined,
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): { id: string; identifierType: string } | undefined {
  if (!id) return undefined;
  const identifierType = getAnalysisIdentifierType(
    exposureQueries.find((q) => q.id === id),
    storedIdentifierType,
  );
  return identifierType ? { id, identifierType } : undefined;
}

export type AssignmentQuerySelection = {
  datasource: string;
  exposureQueryId: string;
  identifierType?: string;
};

/**
 * Whether a saved assignment query selection changed. A missing identifier
 * means the query's legacy identifier, so a client sending that resolved value back is not
 * a change. `loadExposureQueries` only runs when the raw identifiers differ.
 */
export async function hasAssignmentQuerySelectionChanged(
  previous: AssignmentQuerySelection,
  next: AssignmentQuerySelection,
  loadExposureQueries: () => Promise<ExposureQuery[]>,
): Promise<boolean> {
  if (
    previous.datasource !== next.datasource ||
    previous.exposureQueryId !== next.exposureQueryId
  ) {
    return true;
  }
  const previousType = previous.identifierType || undefined;
  const nextType = next.identifierType || undefined;
  if (previousType === nextType) return false;
  const query = (await loadExposureQueries()).find(
    (q) => q.id === next.exposureQueryId,
  );
  return (
    getAnalysisIdentifierType(query, previousType) !==
    getAnalysisIdentifierType(query, nextType)
  );
}

/**
 * Throws rather than let analysis run on an identifier the query no longer
 * returns, including a legacy record whose frozen identifier was removed.
 */
export function assertExposureQueryDeclaresIdentifierType(
  query: ExposureQueryIdentity & Pick<ExposureQuery, "name">,
  storedIdentifierType: string | undefined,
): void {
  const identifierType = getAnalysisIdentifierType(query, storedIdentifierType);
  if (!identifierType) return;
  if (!getExposureQueryIdentifierTypes(query).includes(identifierType)) {
    throw new Error(
      `Assignment query "${query.name || query.id}" no longer declares the "${identifierType}" identifier type. Choose an assignment query that declares it, or a different identifier type, before running analysis.`,
    );
  }
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

/**
 * The SQL builders' input for a saved record: refuses a query that no longer
 * declares the identifier the record analyzes on, then pairs its SQL with that
 * identifier.
 */
export function resolveExposureQueryForAnalysis(
  query: Pick<
    ExposureQuery,
    "id" | "name" | "query" | "userIdType" | "userIdTypes"
  >,
  storedIdentifierType: string | undefined,
): ResolvedExposureQuery {
  assertExposureQueryDeclaresIdentifierType(query, storedIdentifierType);
  return {
    query: query.query,
    identifierType: getAnalysisIdentifierType(query, storedIdentifierType),
  };
}
