import { ExposureQuery } from "shared/types/datasource";
import { ResolvedExposureQuery } from "shared/types/integrations";
import type {
  ApiAssignmentQueryRef,
  ApiAssignmentQueryRefInput,
  AssignmentQueryField,
} from "../validators/assignment-query-field";

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
  assignmentQuery: ApiAssignmentQueryRefInput | undefined,
  deprecatedId: string | undefined,
  field: AssignmentQueryField,
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
  "id" | "name" | "userIdType" | "userIdTypes"
>;

export type ParsedAssignmentQuerySelection<
  Q extends SelectableExposureQuery = SelectableExposureQuery,
> =
  | { ok: true; identifierType: string; query: Q }
  | { ok: false; error: string };

/**
 * Validates a new or changed selection and returns the identifier to store. An
 * omitted identifier becomes the query's first (the new-record default), unless
 * `onOmitted` is "requireUnambiguous" and the query declares several.
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
  }: {
    exposureQueryId: string;
    identifierType?: string;
    onOmitted: "defaultToFirst" | "requireUnambiguous";
    // The REST field to name in the ambiguity error.
    field?: string;
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
  const declared = getExposureQueryIdentifierTypes(query);
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
      error: `Assignment query "${name}" declares several identifier types (${declared.join(", ")}). Set ${field ? `${field}.` : ""}identifierType to choose one.`,
    };
  }
  return declared[0]
    ? { ok: true, identifierType: declared[0], query }
    : {
        ok: false,
        error: `Assignment query "${name}" doesn't declare any identifier types`,
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
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): ApiAssignmentQueryRef {
  const identifierType = id
    ? getAnalysisIdentifierType(
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
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
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
    getAnalysisIdentifierType(query, previousType) ===
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
