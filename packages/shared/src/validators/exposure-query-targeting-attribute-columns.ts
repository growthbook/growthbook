import type { SDKAttributeSchema } from "shared/types/organization";

export type TargetingColumnQuery = {
  id?: string;
  name?: string;
  targetingAttributeColumns?: string[];
};

/** Source of truth — these columns are interpolated as bare SQL identifiers, so injection-safety requires this exact shape. */
export const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** EAQ output column holding the bandit version (weight-update generation) a row was assigned under. */
export const CONTEXTUAL_BANDIT_EAQ_BANDIT_VERSION_COLUMN = "bandit_version";
/** EAQ output column identifying the policy tree leaf (context bucket) a row was assigned in. */
export const CONTEXTUAL_BANDIT_EAQ_LEAF_ID_COLUMN = "leaf_id";
/** EAQ output column holding the per-row variation assignment probabilities (array). */
export const CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN =
  "variation_weights";

/**
 * Extra columns a contextual-bandit assignment query must SELECT. Used later to compute
 * SRM in SQL for contextual bandits. `variation_weights` is an array column; validation
 * only checks the column is present, not its type.
 */
export const CONTEXTUAL_BANDIT_EAQ_REQUIRED_COLUMNS = [
  CONTEXTUAL_BANDIT_EAQ_BANDIT_VERSION_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_LEAF_ID_COLUMN,
  CONTEXTUAL_BANDIT_EAQ_VARIATION_WEIGHTS_COLUMN,
] as const;

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
  exposureQueries: TargetingColumnQuery[] | undefined,
  previousExposureQueries?: TargetingColumnQuery[],
): { queryLabel: string; column: string }[] {
  const allowed = getAllowedTargetingAttributePropertyNames(attributeSchema);
  const previousColumnsByQueryId = new Map<string, Set<string>>();
  for (const q of previousExposureQueries ?? []) {
    previousColumnsByQueryId.set(
      q.id ?? "",
      new Set(q.targetingAttributeColumns ?? []),
    );
  }
  const disallowed: { queryLabel: string; column: string }[] = [];
  for (const q of exposureQueries ?? []) {
    const label = q.name?.trim() || q.id || "";
    const previousColumns = previousColumnsByQueryId.get(q.id ?? "");
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
  exposureQueries: TargetingColumnQuery[] | undefined,
): { queryLabel: string; column: string }[] {
  const malformed: { queryLabel: string; column: string }[] = [];
  for (const q of exposureQueries ?? []) {
    const label = q.name?.trim() || q.id || "";
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
  exposureQueries: TargetingColumnQuery[] | undefined,
  previousExposureQueries?: TargetingColumnQuery[],
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
