import { createHash } from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;
type ConditionObject = Record<string, AnyValue>;

function isPlainObject(v: unknown): v is ConditionObject {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeNode(v: AnyValue): AnyValue {
  if (Array.isArray(v)) return v.map(normalizeNode);
  if (isPlainObject(v)) return normalizeObject(v);
  if (typeof v === "number") return normalizeNumber(v);
  return v;
}

// NaN/Infinity become `null` via JSON.stringify; emit as strings so equivalent conditions compare equal.
function normalizeNumber(n: number): number | string {
  if (!Number.isFinite(n)) return String(n);
  return n;
}

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

function normalizeObject(obj: ConditionObject): ConditionObject | AnyValue {
  if ("$regex" in obj) {
    const normalised: ConditionObject = {
      $regex: normalizeNode(obj["$regex"]),
    };
    if ("$options" in obj) {
      normalised["$options"] = normalizeNode(obj["$options"]);
    }
    return sortObjectKeys(normalised);
  }

  if ("$not" in obj) {
    const inner = normalizeNode(obj["$not"]);
    return { $not: inner };
  }

  if ("$and" in obj) {
    const clauses: AnyValue[] = Array.isArray(obj["$and"])
      ? obj["$and"]
      : [obj["$and"]];
    const flat: ConditionObject[] = [];
    for (const clause of clauses) {
      const c = normalizeNode(clause);
      if (isPlainObject(c) && "$and" in c && Array.isArray(c["$and"])) {
        flat.push(...(c["$and"] as ConditionObject[]));
      } else if (isPlainObject(c)) {
        flat.push(c);
      }
    }
    // Drop empty-object clauses: they match everything and aren't meaningful.
    const nonEmpty = flat.filter((c) => Object.keys(c).length > 0);
    if (nonEmpty.length === 0) return {};
    if (nonEmpty.length === 1) return nonEmpty[0];
    return { $and: sortByJson(nonEmpty) };
  }

  if ("$or" in obj || "$nor" in obj) {
    const key = "$or" in obj ? "$or" : "$nor";
    const clauses: AnyValue[] = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
    const normalised = clauses.map(normalizeNode);
    return { [key]: sortByJson(normalised) };
  }

  const result: ConditionObject = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];

    if (isPlainObject(v)) {
      const keys = Object.keys(v);
      if (keys.length === 1 && keys[0] === "$eq") {
        result[k] = normalizeNode(v["$eq"]);
        continue;
      }
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

  return sortObjectKeys(result);
}

function sortObjectKeys(obj: ConditionObject): ConditionObject {
  const sorted: ConditionObject = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  return sorted;
}

/** Canonical JSON for a targeting condition so equivalent conditions hash identically. */
export function canonicalize(condition: Record<string, unknown>): string {
  if (!isPlainObject(condition)) return "{}";
  return JSON.stringify(normalizeNode(condition));
}

/** Deterministic `ctx_<8 hex>` id from SHA-256 of `<experimentId>|<canonicalize(condition)>`. */
export function deriveContextId(
  experimentId: string,
  condition: Record<string, unknown>,
): string {
  const payload = `${experimentId}|${canonicalize(condition)}`;
  const hex = createHash("sha256").update(payload).digest("hex");
  return `ctx_${hex.slice(0, 8)}`;
}
