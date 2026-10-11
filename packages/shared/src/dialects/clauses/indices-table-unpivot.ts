import type {
  UnpivotLabeledPair,
  UnpivotLabeledPairsResult,
} from "shared/types/sql";

// Builds an unpivot clause that uses a plain CROSS JOIN against a small inline
// indices relation and resolves column_name/value through CASE on the index.
// Used by dialects whose LATERAL implementation can't carry the standard
// pattern (Redshift's LATERAL is SUPER-only, Snowflake rejects UNION ALL in
// correlated subqueries, Vertica restricts LATERAL to a single SELECT).
//
// __factTable is still scanned once; each row is multiplied by the number of
// columns being unpivoted.
export function indicesTableUnpivot(
  pairs: UnpivotLabeledPair[],
): UnpivotLabeledPairsResult {
  const indices = pairs
    .map((_p, i) => (i === 0 ? `SELECT 1 AS __col_idx` : `SELECT ${i + 1}`))
    .join(" UNION ALL ");
  const keyCase = `CASE __col.__col_idx ${pairs
    .map((p, i) => `WHEN ${i + 1} THEN '${p.keyLiteral}'`)
    .join(" ")} END`;
  const valueCase = `CASE __col.__col_idx ${pairs
    .map((p, i) => `WHEN ${i + 1} THEN ${p.valueSql}`)
    .join(" ")} END`;
  return {
    fromContinuation: `CROSS JOIN (${indices}) __col`,
    keyExpr: keyCase,
    valueExpr: valueCase,
  };
}
