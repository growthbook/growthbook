import {
  ATTR_CB_PREFIX,
  CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE,
} from "shared/constants";

/** `in` lists the attribute's allowed levels; `not in` lists excluded levels. */
export type LeafConditionOperator = "in" | "not in";

/**
 * A single per-attribute targeting clause for a contextual-bandit tree leaf,
 * e.g. `{ attribute: "country", levels: ["US", "UK"], operator: "in" }`. A leaf
 * condition is the AND of its clauses.
 */
export type ContextualLeafClause = {
  attribute: string;
  levels: string[];
  operator: LeafConditionOperator;
};

function displayAttributeName(attr: string): string {
  return attr.startsWith(ATTR_CB_PREFIX)
    ? attr.slice(ATTR_CB_PREFIX.length)
    : attr;
}

function sortClauseValues(values: string[]): string[] {
  const allNumeric = values.every((v) => v !== "" && !Number.isNaN(Number(v)));
  return [...values].sort((a, b) =>
    allNumeric ? Number(a) - Number(b) : a.localeCompare(b),
  );
}

/**
 * Union of each attribute's explicitly-claimed values across the sibling leaves,
 * excluding the "Combined" catch-all bucket. Used to negate a leaf that owns the
 * catch-all bucket (see `leafClausesFromContexts`).
 */
function siblingValuesByAttr(
  otherLeafContexts: Record<string, string>[],
): Map<string, Set<string>> {
  const byAttr = new Map<string, Set<string>>();
  otherLeafContexts.forEach((ctx) => {
    Object.keys(ctx).forEach((attr) => {
      if ((ctx[attr] ?? null) === null) return;
      const value = String(ctx[attr]);
      if (value === CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE) return;
      const set = byAttr.get(attr) ?? new Set<string>();
      set.add(value);
      byAttr.set(attr, set);
    });
  });
  return byAttr;
}

/**
 * Factor a contextual-bandit tree leaf's member contexts into one structured
 * clause per attribute.
 * `attributes` is the ordered list of attributes the leaf's condition may
 * constrain — for a tree leaf, exactly the attributes the tree split on along
 * its root→leaf path, in canonical order.
 */
export function leafClausesFromContexts(
  contexts: Record<string, string>[],
  attributes: string[],
  otherLeafContexts: Record<string, string>[] = [],
): ContextualLeafClause[] {
  if (!contexts.length) return [];

  const valuesByAttr = new Map<string, Set<string>>();
  contexts.forEach((ctx) => {
    Object.keys(ctx).forEach((attr) => {
      if ((ctx[attr] ?? null) === null) return;
      const set = valuesByAttr.get(attr) ?? new Set<string>();
      set.add(String(ctx[attr]));
      valuesByAttr.set(attr, set);
    });
  });

  const siblingValues = siblingValuesByAttr(otherLeafContexts);

  const clauses: ContextualLeafClause[] = [];
  attributes.forEach((attr) => {
    const values = valuesByAttr.get(attr);
    if (!values) return;

    if (values.has(CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE)) {
      const complement = sortClauseValues(
        Array.from(siblingValues.get(attr) ?? []).filter((v) => !values.has(v)),
      );
      if (complement.length === 0) return;
      clauses.push({
        attribute: displayAttributeName(attr),
        levels: complement,
        operator: "not in",
      });
      return;
    }

    clauses.push({
      attribute: displayAttributeName(attr),
      levels: sortClauseValues(Array.from(values)),
      operator: "in",
    });
  });

  return clauses;
}

/**
 * Convert structured leaf clauses into a MongoDB-style targeting condition
 * object (the shape the SDK payload and `ConditionDisplay` consume). Single-level
 * clauses collapse to a bare value / `$ne`; multi-level clauses use `$in` / `$nin`.
 */
export function conditionFromLeafClauses(
  clauses: ContextualLeafClause[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  clauses.forEach(({ attribute, levels, operator }) => {
    if (operator === "not in") {
      obj[attribute] =
        levels.length === 1 ? { $ne: levels[0] } : { $nin: levels };
    } else {
      obj[attribute] = levels.length === 1 ? levels[0] : { $in: levels };
    }
  });
  return obj;
}
