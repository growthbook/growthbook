import { ATTR_CB_PREFIX, ATTR_CB_RAW_PREFIX } from "shared/constants";

export function contextualBanditAttrCol(alias: string): string {
  return `${ATTR_CB_PREFIX}${alias}`;
}

export function contextualBanditRawAttrCol(alias: string): string {
  return `${ATTR_CB_RAW_PREFIX}${alias}`;
}

export function isContextualBanditAttrColumn(key: string): boolean {
  return key.startsWith(ATTR_CB_PREFIX);
}

/** Build a targeting condition from flat metric-query row columns (`attr_cb_*` or bare names). */
export function attributeConditionFromMetricRow(
  row: Record<string, string | number | undefined>,
  lowerCaseAttributes: string[],
): Record<string, unknown> {
  // Some SQL dialects (e.g. Snowflake) return unquoted column names in
  // upper case, so normalize row keys before matching against the
  // already-lowercased attribute names.
  const lowerCaseRow: Record<string, string | number | undefined> = {};
  for (const key of Object.keys(row)) {
    lowerCaseRow[key.toLowerCase()] = row[key];
  }

  const condition: Record<string, unknown> = {};
  for (const attr of lowerCaseAttributes) {
    const val =
      lowerCaseRow[contextualBanditAttrCol(attr)] ?? lowerCaseRow[attr];
    if (val !== null && val !== undefined) {
      condition[attr] = val;
    }
  }
  return condition;
}
