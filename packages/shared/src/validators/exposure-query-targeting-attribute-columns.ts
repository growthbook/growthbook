import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";

/** Source of truth — these columns are interpolated as bare SQL identifiers, so injection-safety requires this exact shape. */
export const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Extra columns a contextual-bandit assignment query must SELECT. Used later to compute
 * SRM in SQL for contextual bandits. `variation_weights` is an array column; validation
 * only checks the column is present, not its type.
 */
export const CONTEXTUAL_BANDIT_EAQ_REQUIRED_COLUMNS = [
  "snapshot_update_count",
  "leaf_id",
  "variation_weights",
] as const;

/** A contextual-bandit EAQ is identified solely by the explicit `contextualBandit` flag. */
export function isContextualBanditExposureQuery(
  query: Pick<ExposureQuery, "contextualBandit">,
): boolean {
  return query.contextualBandit === true;
}

/** Invariant: a contextual-bandit EAQ must declare at least one targeting attribute column. */
export function getContextualBanditExposureQueriesMissingTargeting(
  exposureQueries: ExposureQuery[] | undefined,
): { queryLabel: string }[] {
  const problems: { queryLabel: string }[] = [];
  for (const q of exposureQueries ?? []) {
    if (
      q.contextualBandit &&
      (q.targetingAttributeColumns?.length ?? 0) === 0
    ) {
      problems.push({ queryLabel: q.name?.trim() || q.id });
    }
  }
  return problems;
}

export function formatContextualBanditMissingTargetingMessages(
  queryLabels: string[],
): string {
  const unique = [...new Set(queryLabels)];
  return unique
    .map(
      (label) =>
        `${label} is marked as a contextual bandit query but has no targeting attribute columns. Add at least one targeting attribute column.`,
    )
    .join("\n\n");
}

/** Throws when any contextual-bandit EAQ is missing its required targeting attribute columns. */
export function assertContextualBanditExposureQueriesValid(
  exposureQueries: ExposureQuery[] | undefined,
): void {
  const problems =
    getContextualBanditExposureQueriesMissingTargeting(exposureQueries);
  if (problems.length === 0) {
    return;
  }
  throw new Error(
    formatContextualBanditMissingTargetingMessages(
      problems.map((p) => p.queryLabel),
    ),
  );
}

/**
 * Experiment-level guard: a contextual-bandit experiment must reference an assignment query
 * that declares targeting attribute columns. No-op for other experiment types.
 */
export function assertContextualBanditExperimentFieldsValid(args: {
  experimentType?: string;
  exposureQueryId: string;
  exposureQueries: ExposureQuery[] | undefined;
}): void {
  if (args.experimentType !== "contextual-bandit") {
    return;
  }
  const exposureQuery = (args.exposureQueries ?? []).find(
    (q) => q.id === args.exposureQueryId,
  );
  if ((exposureQuery?.targetingAttributeColumns?.length ?? 0) === 0) {
    throw new Error(
      "Contextual bandit experiments require an experiment assignment query with targeting attribute columns.",
    );
  }
}

export function isSafeSqlIdentifier(name: string): boolean {
  return SAFE_SQL_IDENTIFIER.test(name);
}

export function formatMalformedTargetingAttributeColumnMessages(
  columnNames: string[],
): string {
  const unique = [...new Set(columnNames)];
  return unique
    .map(
      (col) =>
        `"${col}" is not a valid column name. Targeting attribute column names must be valid SQL identifiers: only letters, numbers, and underscores are allowed, and they cannot start with a number.`,
    )
    .join("\n\n");
}

export function formatInvalidTargetingAttributeColumnMessages(
  columnNames: string[],
): string {
  const unique = [...new Set(columnNames)];
  return unique
    .map(
      (col) =>
        `${col} is not a saved targeting attribute. Column aliases in your assignment query must match organization targeting attributes (Settings → Attributes).`,
    )
    .join("\n\n");
}

export function getAllowedTargetingAttributePropertyNames(
  attributeSchema: SDKAttributeSchema | undefined,
): Set<string> {
  return new Set(
    (attributeSchema ?? []).filter((a) => !a.archived).map((a) => a.property),
  );
}

export function getInvalidTargetingAttributeColumnsForExposureQueries(
  attributeSchema: SDKAttributeSchema | undefined,
  exposureQueries: ExposureQuery[] | undefined,
  /** When provided, columns already present on the matching saved query are NOT re-validated. */
  previousExposureQueries?: ExposureQuery[],
): { queryLabel: string; column: string }[] {
  const allowed = getAllowedTargetingAttributePropertyNames(attributeSchema);
  const previousColumnsByQueryId = new Map<string, Set<string>>();
  for (const q of previousExposureQueries ?? []) {
    previousColumnsByQueryId.set(
      q.id,
      new Set(q.targetingAttributeColumns ?? []),
    );
  }
  const disallowed: { queryLabel: string; column: string }[] = [];
  for (const q of exposureQueries ?? []) {
    const label = q.name?.trim() || q.id;
    const previousColumns = previousColumnsByQueryId.get(q.id);
    for (const col of q.targetingAttributeColumns ?? []) {
      if (previousColumns?.has(col)) {
        continue;
      }
      if (!allowed.has(col)) {
        disallowed.push({ queryLabel: label, column: col });
      }
    }
  }
  return disallowed;
}

/** Validates every column (including saved ones) because malformed identifiers must never persist. */
export function getMalformedTargetingAttributeColumnsForExposureQueries(
  exposureQueries: ExposureQuery[] | undefined,
): { queryLabel: string; column: string }[] {
  const malformed: { queryLabel: string; column: string }[] = [];
  for (const q of exposureQueries ?? []) {
    const label = q.name?.trim() || q.id;
    for (const col of q.targetingAttributeColumns ?? []) {
      if (!isSafeSqlIdentifier(col)) {
        malformed.push({ queryLabel: label, column: col });
      }
    }
  }
  return malformed;
}

/** Reports malformed (security) columns before unknown (configuration) ones. */
export function assertExposureQueriesTargetingAttributeColumnsValid(
  attributeSchema: SDKAttributeSchema | undefined,
  exposureQueries: ExposureQuery[] | undefined,
  previousExposureQueries?: ExposureQuery[],
): void {
  const malformed =
    getMalformedTargetingAttributeColumnsForExposureQueries(exposureQueries);
  if (malformed.length > 0) {
    throw new Error(
      formatMalformedTargetingAttributeColumnMessages(
        malformed.map((p) => p.column),
      ),
    );
  }

  const problems = getInvalidTargetingAttributeColumnsForExposureQueries(
    attributeSchema,
    exposureQueries,
    previousExposureQueries,
  );
  if (problems.length === 0) {
    return;
  }
  throw new Error(
    formatInvalidTargetingAttributeColumnMessages(
      problems.map((p) => p.column),
    ),
  );
}
