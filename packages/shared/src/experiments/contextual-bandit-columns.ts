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
  attributeColumns: string[],
): Record<string, unknown> {
  const condition: Record<string, unknown> = {};
  for (const attr of attributeColumns) {
    const val = row[contextualBanditAttrCol(attr)] ?? row[attr];
    if (val !== null && val !== undefined) {
      condition[attr] = val;
    }
  }
  return condition;
}
