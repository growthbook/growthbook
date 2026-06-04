import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";

/**
 * Targeting attribute columns are interpolated directly into generated SQL as
 * bare identifiers (column references), which cannot be parameterized. To keep
 * that interpolation injection-safe, every column must be a plain SQL
 * identifier: a letter or underscore followed by letters, numbers, or
 * underscores. This is the single source of truth for that constraint, shared
 * by the input-time validation here and the query builder's last-line guard.
 */
export const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isSafeSqlIdentifier(name: string): boolean {
  return SAFE_SQL_IDENTIFIER.test(name);
}

/** Shared explanation of the SQL-identifier format requirement (plain text). */
export const TARGETING_ATTRIBUTE_COLUMN_FORMAT_HELP =
  "Targeting attribute column names must be valid SQL identifiers: only letters, numbers, and underscores are allowed, and they cannot start with a number.";

export function formatMalformedTargetingAttributeColumnMessages(
  columnNames: string[],
): string {
  const unique = [...new Set(columnNames)];
  return unique
    .map(
      (col) =>
        `"${col}" is not a valid column name. ${TARGETING_ATTRIBUTE_COLUMN_FORMAT_HELP}`,
    )
    .join("\n\n");
}

/** Plain text before the phrase that maps to Settings → Attributes in the UI. */
export const TARGETING_ATTRIBUTE_COLUMN_HELP_BEFORE_SETTINGS_LINK =
  "Column aliases in your assignment query must match organization targeting attributes (";

/** Same phrase as in-app navigation; used in plain-text errors and link labels. */
export const TARGETING_ATTRIBUTE_COLUMN_SETTINGS_LINK_LABEL =
  "Settings → Attributes";

/** Closing punctuation after the settings phrase (parenthesis + sentence period). */
export const TARGETING_ATTRIBUTE_COLUMN_HELP_AFTER_SETTINGS_LINK = ").";

/** Shared suffix for UI and API validation errors (plain text). */
export const TARGETING_ATTRIBUTE_COLUMN_HELP_SENTENCE =
  TARGETING_ATTRIBUTE_COLUMN_HELP_BEFORE_SETTINGS_LINK +
  TARGETING_ATTRIBUTE_COLUMN_SETTINGS_LINK_LABEL +
  TARGETING_ATTRIBUTE_COLUMN_HELP_AFTER_SETTINGS_LINK;

export function formatInvalidTargetingAttributeColumnMessages(
  columnNames: string[],
): string {
  const unique = [...new Set(columnNames)];
  return unique
    .map(
      (col) =>
        `${col} is not a saved targeting attribute. ${TARGETING_ATTRIBUTE_COLUMN_HELP_SENTENCE}`,
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
  /**
   * Previously-saved exposure queries. When provided, columns that already
   * existed on the matching saved query (by id) are NOT re-validated. This
   * keeps an unrelated datasource edit from being blocked because a
   * pre-existing targeting column now points at an archived/removed
   * attribute — only newly added columns are checked.
   */
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
      // Skip columns that were already saved on this query; only validate new ones.
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

/**
 * Targeting columns that are not valid SQL identifiers. Unlike the membership
 * check, this validates every column (including previously saved ones): a
 * malformed identifier is always a hard error because it would otherwise be
 * interpolated into raw SQL, so it should never be allowed to persist.
 */
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

/**
 * @throws Error with message listing malformed or unknown columns when
 * validation fails. Format problems are reported first since they are a hard
 * (security) constraint rather than a configuration mismatch.
 */
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
