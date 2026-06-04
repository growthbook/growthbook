import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";

/** Source of truth — these columns are interpolated as bare SQL identifiers, so injection-safety requires this exact shape. */
export const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isSafeSqlIdentifier(name: string): boolean {
  return SAFE_SQL_IDENTIFIER.test(name);
}

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

export const TARGETING_ATTRIBUTE_COLUMN_HELP_BEFORE_SETTINGS_LINK =
  "Column aliases in your assignment query must match organization targeting attributes (";

export const TARGETING_ATTRIBUTE_COLUMN_SETTINGS_LINK_LABEL =
  "Settings → Attributes";

export const TARGETING_ATTRIBUTE_COLUMN_HELP_AFTER_SETTINGS_LINK = ").";

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
