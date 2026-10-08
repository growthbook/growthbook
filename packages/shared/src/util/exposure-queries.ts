import isEqual from "lodash/isEqual";
import omit from "lodash/omit";
import { ExposureQuery } from "shared/types/datasource";
import { ResolvedExposureQuery } from "shared/types/integrations";
import type {
  ApiAssignmentQueryRef,
  ApiAssignmentQueryRefInput,
  AssignmentQueryField,
} from "../validators/assignment-query-field";
import { isProjectListValidForProject } from ".";

type ExposureQueryIdentity = Pick<
  ExposureQuery,
  "id" | "userIdType" | "userIdTypes"
>;

/** Falls back to `userIdType` for queries saved before `userIdTypes`. */
export function getExposureQueryIdentifierTypes(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
): string[] {
  return query.userIdTypes?.length
    ? query.userIdTypes
    : [query.userIdType].filter(Boolean);
}

/**
 * An identifier for counting a query's units, where any declared one works.
 * Prefers the legacy `userIdType` so reordering doesn't change the counts, but
 * not once the query stops declaring it.
 */
export function getPreferredIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
): string {
  const declared = getExposureQueryIdentifierTypes(query);
  return declared.includes(query.userIdType)
    ? query.userIdType
    : (declared[0] ?? "");
}

/**
 * The identifier a saved record analyzes on: the stored one, even if its query
 * no longer declares it (analysis then refuses to run), else the query's frozen
 * legacy identifier (`userIdType`). Pick a new record's with
 * parseAssignmentQuerySelection, which also checks the query still declares it.
 */
export function resolveAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes">,
  storedIdentifierType: string | undefined,
): string;
export function resolveAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes"> | undefined,
  storedIdentifierType: string | undefined,
): string | undefined;
export function resolveAnalysisIdentifierType(
  query: Pick<ExposureQuery, "userIdType" | "userIdTypes"> | undefined,
  storedIdentifierType: string | undefined,
): string | undefined {
  if (storedIdentifierType) return storedIdentifierType;
  return query
    ? query.userIdType || getExposureQueryIdentifierTypes(query)[0] || ""
    : undefined;
}

/**
 * The identifier to put in a settings hash: undefined when it's the query's
 * frozen legacy one, so hashes saved before identifiers were stored stay valid.
 */
export function getIdentifierTypeForSettingsHash(
  exposureQueryId: string,
  identifierType: string | undefined,
  exposureQueries: ExposureQueryIdentity[],
): string | undefined {
  const query = exposureQueries.find((q) => q.id === exposureQueryId);
  return identifierType &&
    identifierType !== resolveAnalysisIdentifierType(query, undefined)
    ? identifierType
    : undefined;
}

/**
 * Reads a REST body's grouped assignment query field and its deprecated flat
 * `<field>Id`. Both may be sent, as responses return both, but must agree.
 */
export function parseAssignmentQueryInput(
  assignmentQuery: ApiAssignmentQueryRefInput | undefined,
  deprecatedId: string | undefined,
  field: AssignmentQueryField,
): { id: string | undefined; identifierType: string | undefined } {
  if (
    assignmentQuery &&
    deprecatedId !== undefined &&
    deprecatedId !== assignmentQuery.id
  ) {
    throw new Error(
      `${field}.id and the deprecated ${field}Id name different assignment queries`,
    );
  }
  return {
    id: assignmentQuery?.id ?? deprecatedId,
    identifierType: assignmentQuery?.identifierType ?? undefined,
  };
}

/**
 * Maps a REST body's grouped `exposureQuery` onto the stored flat
 * `exposureQueryId` / `exposureQueryIdentifierType`, keeping every other field.
 * Keys are only set when given, so partial update bodies stay partial.
 */
export function flattenExposureQueryInput<
  T extends {
    exposureQuery?: ApiAssignmentQueryRefInput;
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

type SelectableExposureQuery = Pick<
  ExposureQuery,
  "id" | "name" | "userIdType" | "userIdTypes" | "projects"
>;

/**
 * Where a selection is used: a single `project`, or `projects` that must all be
 * covered (holdouts). Omit both to skip the check.
 */
export type AssignmentQueryScope = {
  project?: string;
  projects?: string[];
  /**
   * Inherited by queries without their own project scope. Required so a caller
   * can't leave it out and treat those queries as available everywhere.
   */
  datasourceProjects: string[] | undefined;
};

function getAssignmentQueryScopeError(
  query: Pick<ExposureQuery, "id" | "name" | "projects">,
  { project, projects, datasourceProjects }: AssignmentQueryScope,
): string | null {
  const name = query.name || query.id;
  if (projects) {
    if (
      isExposureQueryAvailableForProjects(query, {
        holdoutProjects: projects,
        datasourceProjects,
      })
    ) {
      return null;
    }
    const scopeSource = query.projects?.length
      ? "its own"
      : "its data source's";
    return projects.length
      ? `Assignment query "${name}" isn't available for every project this holdout covers because of ${scopeSource} project scope`
      : `Assignment query "${name}" is limited by ${scopeSource} project scope, so it can't be used by a holdout that covers all projects`;
  }
  if (
    project !== undefined &&
    !isProjectListValidForProject(
      getExposureQueryProjects(query, datasourceProjects),
      project,
    )
  ) {
    return `Assignment query "${name}" isn't available for the selected project`;
  }
  return null;
}

export type ParsedAssignmentQuerySelection<
  Q extends SelectableExposureQuery = SelectableExposureQuery,
> =
  | {
      ok: true;
      /**
       * What to store. Undefined leaves the record implicit, analyzing on the
       * query's frozen legacy identifier.
       */
      identifierType: string | undefined;
      query: Q;
    }
  | { ok: false; error: string };

/**
 * Validates a new or changed selection and returns the identifier to store. An
 * omitted identifier stays implicit while the query declares the one analysis
 * would fall back to (resolveAnalysisIdentifierType), and is rejected once it
 * doesn't rather than moving to another. "requireUnambiguous" also rejects an
 * omission on a query that declares several, with an error listing them.
 */
export function parseAssignmentQuerySelection<
  Q extends SelectableExposureQuery,
>(
  exposureQueries: Q[],
  {
    exposureQueryId,
    identifierType,
    onOmitted,
    field,
    scope,
  }: {
    exposureQueryId: string;
    identifierType?: string;
    onOmitted: "defaultToFirst" | "requireUnambiguous";
    /** The REST field that errors tell the caller to set. */
    field?: string;
    scope?: AssignmentQueryScope;
  },
): ParsedAssignmentQuerySelection<Q> {
  const query = exposureQueries.find((q) => q.id === exposureQueryId);
  if (!query) {
    return {
      ok: false,
      error: `Assignment query "${exposureQueryId}" doesn't exist on this data source`,
    };
  }
  const name = query.name || query.id;
  const scopeError = scope ? getAssignmentQueryScopeError(query, scope) : null;
  if (scopeError) return { ok: false, error: scopeError };
  const declared = getExposureQueryIdentifierTypes(query);
  const identifierField = `${field ? `${field}.` : ""}identifierType`;
  if (identifierType) {
    return declared.includes(identifierType)
      ? { ok: true, identifierType, query }
      : {
          ok: false,
          error: `Assignment query "${name}" doesn't declare the "${identifierType}" identifier type`,
        };
  }
  if (onOmitted === "requireUnambiguous" && declared.length > 1) {
    return {
      ok: false,
      error: `Assignment query "${name}" declares several identifier types (${declared.join(", ")}). Set ${identifierField} to choose one.`,
    };
  }
  const legacyType = resolveAnalysisIdentifierType(query, undefined);
  if (!legacyType) {
    return {
      ok: false,
      error: `Assignment query "${name}" doesn't declare any identifier types`,
    };
  }
  return declared.includes(legacyType)
    ? { ok: true, identifierType: undefined, query }
    : {
        ok: false,
        error: `Assignment query "${name}" no longer declares its default identifier type "${legacyType}". Set ${identifierField} to choose one.`,
      };
}

/**
 * API shape of a stored assignment query selection. Legacy records (no stored
 * identifier) report their query's legacy identifier; null when that can't be
 * resolved, or no query is selected.
 */
export function toApiAssignmentQueryRef(
  id: string,
  storedIdentifierType: string | undefined,
  exposureQueries: ExposureQueryIdentity[],
): ApiAssignmentQueryRef {
  const identifierType = id
    ? resolveAnalysisIdentifierType(
        exposureQueries.find((q) => q.id === id),
        storedIdentifierType,
      )
    : undefined;
  return { id, identifierType: identifierType || null };
}

export type AssignmentQuerySelection = {
  datasource: string;
  exposureQueryId: string;
  identifierType?: string;
};

/**
 * Whether two selections analyze on the same thing. An unset identifier means
 * the query's legacy one, so echoing that resolved value back is the same.
 * Without the query, only identical raw identifiers count as the same.
 */
export function isSameAssignmentQuerySelection(
  previous: AssignmentQuerySelection,
  next: AssignmentQuerySelection,
  exposureQueries: ExposureQueryIdentity[],
): boolean {
  if (
    previous.datasource !== next.datasource ||
    previous.exposureQueryId !== next.exposureQueryId
  ) {
    return false;
  }
  const previousType = previous.identifierType || undefined;
  const nextType = next.identifierType || undefined;
  if (previousType === nextType) return true;
  const query = exposureQueries.find((q) => q.id === next.exposureQueryId);
  return (
    resolveAnalysisIdentifierType(query, previousType) ===
    resolveAnalysisIdentifierType(query, nextType)
  );
}

/**
 * `next`, keeping `previous`'s identifier when it names the same query without
 * one, so a partial update doesn't drop the stored identifier.
 */
export function withKeptIdentifierType(
  previous: AssignmentQuerySelection | null,
  next: AssignmentQuerySelection,
): AssignmentQuerySelection {
  const sameQuery =
    previous?.datasource === next.datasource &&
    previous?.exposureQueryId === next.exposureQueryId;
  return {
    ...next,
    identifierType:
      next.identifierType ||
      (sameQuery ? previous?.identifierType : undefined) ||
      undefined,
  };
}

export type AssignmentQuerySelectionChange =
  | { ok: true; identifierType: string | undefined; changed: boolean }
  | { ok: false; error: string };

/**
 * The identifier to store when `next` replaces `previous` (null on create).
 * When `next` names the same query without an identifier, the stored one is
 * kept (withKeptIdentifierType). An unchanged selection keeps `previous`'s
 * stored value without re-validating it: echoing an implicit record's resolved
 * identifier leaves it implicit, and a query that drifted since doesn't block
 * unrelated edits. A new or changed selection goes through
 * parseAssignmentQuerySelection.
 */
export function resolveAssignmentQuerySelectionChange(
  exposureQueries: SelectableExposureQuery[],
  {
    previous,
    next,
    onOmitted,
    field,
    scope,
  }: {
    previous: AssignmentQuerySelection | null;
    next: AssignmentQuerySelection;
    onOmitted: "defaultToFirst" | "requireUnambiguous";
    field?: string;
    // Only checked for a new or changed selection.
    scope?: AssignmentQueryScope;
  },
): AssignmentQuerySelectionChange {
  const kept = withKeptIdentifierType(previous, next);
  if (
    previous &&
    isSameAssignmentQuerySelection(previous, kept, exposureQueries)
  ) {
    return {
      ok: true,
      identifierType: previous.identifierType || undefined,
      changed: false,
    };
  }
  const parsed = parseAssignmentQuerySelection(exposureQueries, {
    exposureQueryId: kept.exposureQueryId,
    identifierType: kept.identifierType,
    onOmitted,
    field,
    scope,
  });
  return parsed.ok
    ? { ok: true, identifierType: parsed.identifierType, changed: true }
    : parsed;
}

/** A query's own projects, else its data source's. Empty means all projects. */
export function getExposureQueryProjects(
  query: Pick<ExposureQuery, "projects">,
  datasourceProjects: string[] | undefined,
): string[] {
  return query.projects?.length ? query.projects : (datasourceProjects ?? []);
}

/**
 * For resources spanning several projects (holdouts): the query must be usable
 * by every one of them. A holdout with no projects covers all projects, so only
 * a query unrestricted on both itself and its data source qualifies.
 */
export function isExposureQueryAvailableForProjects(
  query: Pick<ExposureQuery, "projects">,
  {
    holdoutProjects,
    datasourceProjects,
  }: { holdoutProjects: string[]; datasourceProjects: string[] | undefined },
): boolean {
  const scope = getExposureQueryProjects(query, datasourceProjects);
  if (!scope.length) return true;
  if (!holdoutProjects.length) return false;
  return holdoutProjects.every((project) => scope.includes(project));
}

/**
 * Each query's own projects must be a subset of the data source's. Empty
 * data source projects means all projects; a query with none inherits them.
 */
export function assertExposureQueriesWithinProjectScope(
  exposureQueries: Pick<ExposureQuery, "name" | "projects">[],
  datasourceProjects: string[],
): void {
  if (!datasourceProjects.length) return;
  const violations = exposureQueries.flatMap((query) => {
    const outside = (query.projects ?? []).filter(
      (project) => !datasourceProjects.includes(project),
    );
    return outside.length ? [`"${query.name}" (${outside.join(", ")})`] : [];
  });
  if (!violations.length) return;
  throw new Error(
    `These experiment assignment queries are scoped to projects the data source is not: ${violations.join("; ")}. Update the assignment query projects to be within the data source's projects.`,
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
  const identifierType = resolveAnalysisIdentifierType(
    query,
    storedIdentifierType,
  );
  if (!identifierType) return;
  if (!getExposureQueryIdentifierTypes(query).includes(identifierType)) {
    throw new Error(
      `Assignment query "${query.name || query.id}" no longer declares the "${identifierType}" identifier type. Choose an assignment query that declares it, or a different identifier type, before running analysis.`,
    );
  }
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
    identifierType: resolveAnalysisIdentifierType(query, storedIdentifierType),
  };
}

/**
 * Assignment queries added, changed or removed between two lists, matched by
 * id. Validation errors are written by the server, so they don't count.
 */
export function getChangedExposureQueries<
  Q extends { id?: string; error?: unknown },
>(previous: Q[], next: Q[]): { previous: Q | null; next: Q | null }[] {
  const byId = new Map(previous.filter((q) => q.id).map((q) => [q.id, q]));
  const changes: { previous: Q | null; next: Q | null }[] = [];
  for (const query of next) {
    const before = query.id ? byId.get(query.id) : undefined;
    if (before) byId.delete(query.id);
    if (!before || !isEqual(omit(before, "error"), omit(query, "error"))) {
      changes.push({ previous: before ?? null, next: query });
    }
  }
  for (const removed of byId.values()) {
    changes.push({ previous: removed, next: null });
  }
  return changes;
}
