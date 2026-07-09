import { ATTR_CB_PREFIX } from "shared/constants";

function displayAttributeName(attr: string): string {
  return attr.startsWith(ATTR_CB_PREFIX)
    ? attr.slice(ATTR_CB_PREFIX.length)
    : attr;
}

function orderAttributes(keys: string[], attributeOrder: string[]): string[] {
  return [
    ...attributeOrder.filter((attr) => keys.includes(attr)),
    ...keys.filter((attr) => !attributeOrder.includes(attr)),
  ];
}

function sortClauseValues(values: string[]): string[] {
  const allNumeric = values.every((v) => v !== "" && !Number.isNaN(Number(v)));
  return [...values].sort((a, b) =>
    allNumeric ? Number(a) - Number(b) : a.localeCompare(b),
  );
}

type LeafClause = { attr: string; values: string[] };

function factorLeafContexts(
  contexts: Record<string, string>[],
): LeafClause[] | null {
  if (!contexts.length) return [];

  const keysOf = (ctx: Record<string, string>) =>
    Object.keys(ctx)
      .filter((k) => ctx[k] != null)
      .sort();

  const firstKeys = keysOf(contexts[0]);
  const sameKeys = contexts.every((ctx) => {
    const ks = keysOf(ctx);
    return (
      ks.length === firstKeys.length && ks.every((k, i) => k === firstKeys[i])
    );
  });
  if (!sameKeys) return null;

  const valuesByKey = new Map<string, Set<string>>(
    firstKeys.map((k) => [k, new Set<string>()]),
  );
  contexts.forEach((ctx) =>
    firstKeys.forEach((k) => valuesByKey.get(k)?.add(String(ctx[k]))),
  );

  const varyingKeys = firstKeys.filter(
    (k) => (valuesByKey.get(k)?.size ?? 0) > 1,
  );
  if (varyingKeys.length > 1) return null;

  return firstKeys.map((k) => ({
    attr: k,
    values: sortClauseValues(Array.from(valuesByKey.get(k) ?? [])),
  }));
}

function contextToEqualityObject(
  attributes: Record<string, string>,
  attributeOrder: string[],
): Record<string, string> {
  const keys = orderAttributes(
    Object.keys(attributes).filter((attr) => attributes[attr] != null),
    attributeOrder,
  );
  const obj: Record<string, string> = {};
  keys.forEach((attr) => {
    obj[displayAttributeName(attr)] = String(attributes[attr]);
  });
  return obj;
}

/**
 * Convert a leaf's member contexts into a deterministic MongoDB-style targeting
 * condition object (attribute aliases de-prefixed). When the contexts factor
 * cleanly (shared keys, ≤1 varying attribute) we emit a single AND object —
 * collapsing the varying attribute into `$in` so it reads as `attr is any of
 * [...]`. Otherwise we emit an `$or` of explicit per-context equality objects so
 * we never over-claim the covered combinations.
 *
 * Output ordering is deterministic for a given set of contexts, so callers can
 * compare two conditions with a plain structural / `JSON.stringify` equality
 * check (this replaces the old `deriveContextId` hash).
 */
export function leafConditionFromContexts(
  contexts: Record<string, string>[],
  attributeOrder: string[],
): Record<string, unknown> {
  const clauses = factorLeafContexts(contexts);

  if (clauses) {
    const ordered = orderAttributes(
      clauses.map((clause) => clause.attr),
      attributeOrder,
    );
    const byAttr = new Map(clauses.map((clause) => [clause.attr, clause]));
    const obj: Record<string, unknown> = {};
    ordered.forEach((attr) => {
      const clause = byAttr.get(attr);
      if (!clause) return;
      obj[displayAttributeName(attr)] =
        clause.values.length === 1 ? clause.values[0] : { $in: clause.values };
    });
    return obj;
  }

  return {
    $or: contexts.map((ctx) => contextToEqualityObject(ctx, attributeOrder)),
  };
}
