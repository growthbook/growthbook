import type { SqlDialect } from "shared/types/sql";

/**
 * Trino/Presto `jsonArray` (Athena and Presto data sources), shared because
 * the two-branch probe below is too subtle to duplicate.
 *
 * Every other dialect coerces the column to a string and parses it, which
 * covers both a text and a native JSON `items` column. Trino has no single
 * coercion that does: `CAST(x AS VARCHAR)` is identity for text but refuses a
 * JSON array, and `json_format` only accepts JSON. So probe with the VARCHAR
 * cast first — it fails exactly on the case we need to detect, whereas
 * `try_cast(x AS JSON)` succeeds for both types and so cannot be the probe.
 * `jsonColumn` is interpolated twice, so it must be a plain column reference.
 */
export const trinoJsonArray: NonNullable<SqlDialect["jsonArray"]> = {
  unnest: (jsonColumn, itemAlias) =>
    `CROSS JOIN UNNEST(CAST(json_parse(COALESCE(try_cast(${jsonColumn} AS VARCHAR), json_format(CAST(${jsonColumn} AS JSON)))) AS ARRAY(JSON))) AS ${itemAlias}_t(${itemAlias})`,
  fieldText: (itemAlias, field) =>
    `json_extract_scalar(${itemAlias}, '$.${field}')`,
};
