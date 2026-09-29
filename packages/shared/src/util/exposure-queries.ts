import { ExposureQuery } from "shared/types/datasource";
import { ResolvedExposureQuery } from "shared/types/integrations";
import type {
  ApiAssignmentQueryRef,
  ApiAssignmentQueryRefInput,
  AssignmentQueryField,
} from "../validators/assignment-query-field";
import type {
  ApiRampMonitoringConfig,
  RampMonitoringConfig,
} from "../validators/ramp-schedule";

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
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): string | undefined {
  const query = exposureQueries.find((q) => q.id === exposureQueryId);
  return identifierType &&
    identifierType !== resolveAnalysisIdentifierType(query, undefined)
    ? identifierType
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
 * The identifier to store when `next` replaces `previous` (null on create),
 * keeping the stored one per withKeptIdentifierType. An unchanged selection
 * isn't re-validated, so a query that drifted since doesn't block unrelated
 * edits; a new or changed one is parsed.
 */
export function resolveAssignmentQuerySelectionChange(
  exposureQueries: SelectableExposureQuery[],
  {
    previous,
    next,
    onOmitted,
    field,
  }: {
    previous: AssignmentQuerySelection | null;
    next: AssignmentQuerySelection;
    onOmitted: "defaultToFirst" | "requireUnambiguous";
    field?: string;
  },
): AssignmentQuerySelectionChange {
  const kept = withKeptIdentifierType(previous, next);
  if (
    previous &&
    isSameAssignmentQuerySelection(previous, kept, exposureQueries)
  ) {
    return { ok: true, identifierType: kept.identifierType, changed: false };
  }
  const parsed = parseAssignmentQuerySelection(exposureQueries, {
    exposureQueryId: kept.exposureQueryId,
    identifierType: kept.identifierType,
    onOmitted,
    field,
  });
  return parsed.ok
    ? { ok: true, identifierType: parsed.identifierType, changed: true }
    : parsed;
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

// Ramps and ramp templates store their assignment selection flat, nested in the
// monitoring config.
export function toMonitoringSelection(
  mc: Pick<
    RampMonitoringConfig,
    "datasourceId" | "exposureQueryId" | "exposureQueryIdentifierType"
  >,
): AssignmentQuerySelection {
  return {
    datasource: mc.datasourceId,
    exposureQueryId: mc.exposureQueryId,
    identifierType: mc.exposureQueryIdentifierType,
  };
}

// The API's grouped exposureQuery supersedes the deprecated exposureQueryId; the
// stored config stays flat.
export function apiMonitoringConfigToInternal<
  T extends {
    datasourceId: string;
    exposureQuery?: ApiAssignmentQueryRefInput;
    exposureQueryId?: string;
  },
>(
  mc: T,
  previous?: Pick<
    RampMonitoringConfig,
    "datasourceId" | "exposureQueryId" | "exposureQueryIdentifierType"
  > | null,
) {
  const { exposureQueryId, ...flat } = flattenExposureQueryInput(mc);
  if (!exposureQueryId) {
    throw new Error("monitoringConfig.exposureQuery is required");
  }
  // The config is replaced whole, so re-sending the same query without an
  // identifier would otherwise drop the stored one for the legacy default.
  const keepsIdentifier =
    !flat.exposureQueryIdentifierType &&
    !!previous?.exposureQueryIdentifierType &&
    previous.datasourceId === mc.datasourceId &&
    previous.exposureQueryId === exposureQueryId;
  return {
    ...flat,
    exposureQueryId,
    ...(keepsIdentifier
      ? { exposureQueryIdentifierType: previous.exposureQueryIdentifierType }
      : {}),
  };
}

export function monitoringConfigToApi(
  mc: RampMonitoringConfig,
  exposureQueries: Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">[],
): ApiRampMonitoringConfig {
  const { exposureQueryIdentifierType, ...rest } = mc;
  return {
    ...rest,
    exposureQuery: toApiAssignmentQueryRef(
      rest.exposureQueryId,
      exposureQueryIdentifierType,
      exposureQueries,
    ),
  };
}
