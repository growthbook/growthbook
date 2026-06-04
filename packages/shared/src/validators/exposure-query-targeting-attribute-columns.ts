import type { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";

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
 * @throws Error with message listing unknown columns when validation fails.
 */
export function assertExposureQueriesTargetingAttributeColumnsValid(
  attributeSchema: SDKAttributeSchema | undefined,
  exposureQueries: ExposureQuery[] | undefined,
  previousExposureQueries?: ExposureQuery[],
): void {
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
