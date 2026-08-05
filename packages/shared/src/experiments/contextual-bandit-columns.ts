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

/**
 * Reader for an attribute's value in a flat metric-query row (`attr_cb_*` or
 * bare column name).
 *
 * The alias embeds the attribute's column name, which may be mixed case. We emit
 * it unquoted, so warehouses that fold identifiers (Postgres, Redshift) return
 * it lowercased while others (BigQuery, ClickHouse) preserve it as written;
 * hence lookups are case-insensitive. Every consumer must read attribute values
 * through this.
 */
export function metricRowAttributeReader(
  row: Record<string, unknown>,
): (attribute: string) => unknown {
  const lowerCaseRow: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    lowerCaseRow[key.toLowerCase()] = row[key];
  }
  return (attribute: string) => {
    const lowerCaseAttribute = attribute.toLowerCase();
    return (
      lowerCaseRow[contextualBanditAttrCol(lowerCaseAttribute)] ??
      lowerCaseRow[lowerCaseAttribute]
    );
  };
}
