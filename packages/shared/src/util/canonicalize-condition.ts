import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;
type ConditionObject = Record<string, AnyValue>;

/** Returns true iff `v` is a plain (non-array, non-null) object. */
function isPlainObject(v: unknown): v is ConditionObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Normalize a single value node — recursing into objects and arrays.
 *
 * Rules applied:
 *  1.  Primitives: numbers go through `normalizeNumber`; all others pass through.
 *  2.  Arrays: each element is recursively normalized (no sorting here — callers
 *      that need sorted arrays, e.g. `$in`, do it themselves).
 *  3.  Plain objects: delegated to `normalizeObject`.
 */
function normalizeNode(v: AnyValue): AnyValue {
  if (Array.isArray(v)) return v.map(normalizeNode);
  if (isPlainObject(v)) return normalizeObject(v);
  if (typeof v === "number") return normalizeNumber(v);
  return v;
}

/**
 * Rule 10: Stable number serialization.
 *
 * `JSON.stringify` already renders `1` and `1.0` identically, but `NaN` and
 * `±Infinity` become `null` which loses type information. Represent them as
 * strings so two conditions that reference NaN/Infinity still compare equal.
 */
function normalizeNumber(n: number): number | string {
  if (!Number.isFinite(n)) return String(n);
  return n;
}

/**
 * Stable sort of an array of values by their canonical JSON representation.
 * Used for `$in`, `$nin`, `$all`, `$or`, `$nor` to make order irrelevant.
 */
function sortByJson(arr: AnyValue[]): AnyValue[] {
  return [...arr].sort((a, b) => {
    const ja = stableJsonKey(a);
    const jb = stableJsonKey(b);
    return ja < jb ? -1 : ja > jb ? 1 : 0;
  });
}

function stableJsonKey(v: AnyValue): string {
  return JSON.stringify(normalizeNode(v)) ?? "";
}

/**
 * Core normalization: takes a plain condition object and returns its canonical
 * equivalent.  Rules (in application order):
 *
 *  3.  `$eq` unwrap    — `{ key: { $eq: v } }` → `{ key: v }`
 *  4.  `$in`/`$nin`/`$all` value sort
 *  5.  `$and` flatten  — nested `$and` arrays merged into the parent
 *  6.  `$and` single-element unwrap — `{ $and: [cond] }` → `cond`
 *  7.  `$or`/`$nor` element sort
 *  8.  `$not` recursion
 *  9.  `$regex`/`$options` rewrite — stable two-key form regardless of insertion order
 * 11.  All object keys sorted alphabetically (applied to every sub-object)
 */
function normalizeObject(obj: ConditionObject): ConditionObject | AnyValue {
  // Rule 9: $regex / $options rewrite.
  // A sub-object may contain both $regex and $options in any order; normalise
  // to a two-key object with keys sorted alphabetically (i.e. $options first).
  // This is handled implicitly by the key-sort at the bottom, but we also need
  // to strip unknown keys around $regex to avoid ambiguous forms.
  if ("$regex" in obj) {
    const normalised: ConditionObject = {
      $regex: normalizeNode(obj["$regex"]),
    };
    if ("$options" in obj) {
      normalised["$options"] = normalizeNode(obj["$options"]);
    }
    // Sort keys so $options always precedes $regex
    return sortObjectKeys(normalised);
  }

  // Rule 8: $not recursion.
  if ("$not" in obj) {
    const inner = normalizeNode(obj["$not"]);
    return { $not: inner };
  }

  // Rules 5 & 6: $and flatten + single-element unwrap.
  if ("$and" in obj) {
    const clauses: AnyValue[] = Array.isArray(obj["$and"])
      ? obj["$and"]
      : [obj["$and"]];
    const flat: ConditionObject[] = [];
    for (const clause of clauses) {
      const c = normalizeNode(clause);
      // Flatten nested $and
      if (isPlainObject(c) && "$and" in c && Array.isArray(c["$and"])) {
        flat.push(...(c["$and"] as ConditionObject[]));
      } else if (isPlainObject(c)) {
        flat.push(c);
      }
    }
    // Discard empty-object clauses (they match everything, not meaningful)
    const nonEmpty = flat.filter((c) => Object.keys(c).length > 0);
    if (nonEmpty.length === 0) return {};
    if (nonEmpty.length === 1) return nonEmpty[0];
    // Rule 7 extension: $and is commutative, so sort clauses for order-independence
    return { $and: sortByJson(nonEmpty) };
  }

  // Rule 7: $or / $nor element sort.
  if ("$or" in obj || "$nor" in obj) {
    const key = "$or" in obj ? "$or" : "$nor";
    const clauses: AnyValue[] = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
    const normalised = clauses.map(normalizeNode);
    return { [key]: sortByJson(normalised) };
  }

  // General object: apply rules 3, 4, and 11.
  const result: ConditionObject = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];

    if (isPlainObject(v)) {
      // Rule 3: $eq unwrap — { field: { $eq: value } } → { field: value }
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$eq") {
        result[k] = normalizeNode(v["$eq"]);
        continue;
      }
      // Rule 4: $in / $nin / $all value sort within a field's sub-object
      const sub: ConditionObject = {};
      for (const op of Object.keys(v)) {
        if (op === "$in" || op === "$nin" || op === "$all") {
          const arr: AnyValue[] = Array.isArray(v[op]) ? v[op] : [v[op]];
          sub[op] = sortByJson(arr.map(normalizeNode));
        } else {
          sub[op] = normalizeNode(v[op]);
        }
      }
      result[k] = sortObjectKeys(sub);
      continue;
    }

    result[k] = normalizeNode(v);
  }

  // Rule 11: sort keys alphabetically
  return sortObjectKeys(result);
}

/** Returns a new object with keys sorted alphabetically. */
function sortObjectKeys(obj: ConditionObject): ConditionObject {
  const sorted: ConditionObject = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return sorted;
}

/**
 * Serialises a GrowthBook / MongoDB-style targeting condition to a canonical
 * JSON string so that semantically equivalent conditions produce identical
 * output (and thus the same hash).
 *
 * @param condition  Plain-object condition (e.g. `{ country: "US" }`).
 *                   Passing `null` / `undefined` / a non-object returns `"{}"`.
 */
export function canonicalize(condition: Record<string, unknown>): string {
  if (!isPlainObject(condition)) return "{}";
  return JSON.stringify(normalizeNode(condition));
}

/**
 * Derives a stable, short context identifier for a (experimentId, condition)
 * pair.  The id is deterministic: the same experiment + condition always
 * produces the same `ctx_` prefixed id regardless of insertion order of
 * condition keys or semantically irrelevant variations.
 *
 * Format: `ctx_<8 hex chars>` (first 8 chars of the SHA-256 of
 * `"<experimentId>|<canonicalize(condition)>"`).
 */
export function deriveContextId(
  experimentId: string,
  condition: Record<string, unknown>,
): string {
  const payload = `${experimentId}|${canonicalize(condition)}`;
  const hex = createHash("sha256").update(payload).digest("hex");
  return `ctx_${hex.slice(0, 8)}`;
}
