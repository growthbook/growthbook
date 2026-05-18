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
): { queryLabel: string; column: string }[] {
  const allowed = getAllowedTargetingAttributePropertyNames(attributeSchema);
  const disallowed: { queryLabel: string; column: string }[] = [];
  for (const q of exposureQueries ?? []) {
    const label = q.name?.trim() || q.id;
    for (const col of q.targetingAttributeColumns ?? []) {
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
): void {
  const problems = getInvalidTargetingAttributeColumnsForExposureQueries(
    attributeSchema,
    exposureQueries,
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

/**
 * @throws Error when a contextual bandit experiment lacks a compatible assignment query.
 */
export function assertContextualBanditExperimentFieldsValid({
  experimentType,
  banditIsContextual,
  exposureQueryId,
  exposureQueries,
}: {
  experimentType: string | undefined;
  banditIsContextual: boolean | undefined;
  exposureQueryId: string | undefined;
  exposureQueries: ExposureQuery[] | undefined;
}): void {
  if (!banditIsContextual) {
    return;
  }
  if (experimentType !== "multi-armed-bandit") {
    throw new Error(
      "banditIsContextual is only valid for multi-armed-bandit experiments",
    );
  }
  if (!exposureQueryId) {
    throw new Error(
      "An experiment assignment query is required for contextual bandits",
    );
  }
  const queries = exposureQueries ?? [];
  if (queries.length === 0) {
    throw new Error(
      "No experiment assignment queries exist for this data source. Add a contextual bandit assignment query, then try again.",
    );
  }
  const selected = queries.find((q) => q.id === exposureQueryId);
  if (!selected?.targetingAttributeColumns?.length) {
    throw new Error(
      "Contextual bandits require an experiment assignment query with targeting attribute columns configured",
    );
  }
}
