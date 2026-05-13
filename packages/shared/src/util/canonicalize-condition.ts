import { createHash } from "crypto";
import type { ConditionInterface } from "@growthbook/growthbook";

/**
 * Bumped any time the canonical form (or hash-input layout) changes in a way
 * that could produce a different `contextId` for the same logical condition.
 * Persisted alongside each ContextualBanditEvent so consumers can detect a
 * re-canonicalization and treat older contextIds as stale.
 */
export const CANONICAL_FORM_VERSION = "v1" as const;

/**
 * Default number of hex chars taken from the SHA-256 digest when forming a
 * `contextId`. The orchestrator widens this to 12 on a write-time collision
 * (CB MVP plan §A1.3) — call `deriveContextIdWithSliceLength` for that path.
 */
const DEFAULT_HASH_SLICE = 8;

/** Operators whose value is an unordered set (rule 4 — sort elements). */
const ARRAY_VALUE_OPERATORS = new Set([
  "$in",
  "$nin",
  "$all",
  "$alli",
  "$inGroup",
  "$notInGroup",
]);

/**
 * Top-level (or nested) logical operators. Used by `$and` merge logic to
 * detect cross-child collisions on the same logical key (rule 5 — keep `$and`).
 */
const LOGICAL_OPERATORS = new Set(["$and", "$or", "$nor", "$not"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  // Defensive: reject Date / Buffer / class instances. Canonical input shouldn't
  // contain them, but if a caller hands one in we treat it as opaque rather than
  // recursing into class internals.
  return proto === Object.prototype || proto === null;
}

/** True iff every key of `v` starts with `$` (i.e. it's an operator object). */
function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length === 0) return false;
  return keys.every((k) => k.startsWith("$"));
}

/**
 * Compact JSON serializer. Sorts object keys (rule 2/3), defers number
 * formatting to `JSON.stringify` (which already produces the shortest
 * round-trip per ECMA-262 — rule 9), and rejects non-finite numbers because
 * they'd round-trip as `null` and silently collide.
 *
 * Key sort uses default string comparison (UTF-16 code unit order). This
 * matches Unicode codepoint order for the BMP, which covers every realistic
 * operator name (`$`-prefixed ASCII) and the vast majority of user-supplied
 * attribute keys.
 */
function stringifySorted(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `canonicalize: non-finite number ${value} cannot be canonicalized`,
        );
      }
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stringifySorted).join(",") + "]";
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map(
      (k) => JSON.stringify(k) + ":" + stringifySorted(value[k]),
    );
    return "{" + parts.join(",") + "}";
  }
  throw new Error(
    `canonicalize: unsupported value of type ${typeof value} in condition`,
  );
}

/**
 * Stable sort comparator that orders values by their canonical JSON form.
 * Used by rule 4 (`$in`/`$nin`/etc.) and rule 6 (`$or`/`$nor` child sort).
 */
function compareByCanonicalJson(a: unknown, b: unknown): number {
  const ja = stringifySorted(a);
  const jb = stringifySorted(b);
  if (ja < jb) return -1;
  if (ja > jb) return 1;
  return 0;
}

/**
 * Normalize a literal RHS value (not an operator object). Recurses into
 * arrays and nested plain objects so embedded structures get key-sorted too.
 */
function normalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (isPlainObject(v)) {
    // Nested object value (e.g. an `$elemMatch` operand without `$`-keys, or a
    // literal sub-document). Treat as a sub-condition for key-sort stability;
    // it has no operator semantics so the recursion only sorts keys.
    return normalizeCondition(v);
  }
  return v;
}

/**
 * Normalize the operator object on the RHS of a field key (`{a: {$gt: 5}}`'s
 * inner `{$gt: 5}`). Implements rules 1 (`$eq` unwrap), 4 (sort set values),
 * 7 (`$not` recurse), and 8 (`$regexi` rewrite to `$regex` + `$options:"i"`).
 *
 * Returns either a bare value (rule 1 collapse) or a normalized operator
 * object. Key sort happens at serialization time, not here.
 */
function normalizeOperatorObject(op: Record<string, unknown>): unknown {
  const keys = Object.keys(op);

  // Rule 1: `{$eq: x}` → bare `x`. Only operator that unwraps; do this before
  // touching siblings since the unwrap collapses the whole object.
  if (keys.length === 1 && keys[0] === "$eq") {
    return normalizeValue(op["$eq"]);
  }

  const result: Record<string, unknown> = {};

  for (const k of keys) {
    const v = op[k];

    if (k === "$regexi") {
      // Rule 8: rewrite to canonical `$regex` + `$options` containing 'i'.
      // Idempotently merge if a sibling `$options` is also present.
      result["$regex"] = v;
      const existing = result["$options"];
      if (typeof existing === "string") {
        if (!existing.includes("i")) result["$options"] = existing + "i";
      } else {
        result["$options"] = "i";
      }
      continue;
    }

    if (k === "$options") {
      const existing = result["$options"];
      if (typeof existing === "string" && typeof v === "string") {
        // Deduplicate flags so `$regexi` + explicit `$options: "i"` collapses
        // to a single `i`, and sort the result for determinism.
        const merged = new Set([...existing, ...v]);
        result["$options"] = [...merged].sort().join("");
      } else {
        result["$options"] = v;
      }
      continue;
    }

    if (k === "$regex") {
      // An explicit `$regex` value wins over one synthesized by a sibling
      // `$regexi` (rare/contradictory input, but choose deterministically).
      result["$regex"] = v;
      continue;
    }

    if (ARRAY_VALUE_OPERATORS.has(k) && Array.isArray(v)) {
      // Rule 4: stable-sort the value array by canonical JSON of each element.
      const normalized = v.map(normalizeValue);
      normalized.sort(compareByCanonicalJson);
      result[k] = normalized;
      continue;
    }

    if (k === "$not") {
      // Rule 7: operand canonicalized recursively. `$not` inside an operator
      // object operates on another operator object (`{a: {$not: {$gt: 5}}}`).
      result[k] = isPlainObject(v)
        ? normalizeOperatorObject(v)
        : normalizeValue(v);
      continue;
    }

    if (k === "$elemMatch") {
      // `$elemMatch` operand is either an operator object or a full nested
      // condition. `normalizeCondition` handles both by recursing on keys.
      result[k] = isPlainObject(v) ? normalizeCondition(v) : normalizeValue(v);
      continue;
    }

    result[k] = normalizeValue(v);
  }

  return result;
}

/**
 * Attempt to merge the (already-normalized) children of an `$and` into a
 * single flat object (rule 5). Returns the merged object on full success, or
 * `null` if any cross-child collision is unmergeable — the caller then keeps
 * the original `$and: [...]` form.
 *
 * Mergeable cases:
 *   - distinct keys across children: union them
 *   - same field key, both values are operator objects with disjoint operator
 *     keys: combine into a single operator object
 *
 * Unmergeable cases (rule 5 — "Unmergeable scalar+operator combos on the same
 * key keep `$and`"):
 *   - same logical-operator key on two children (e.g. two `$or` clauses)
 *   - scalar+anything on the same field key
 *   - operator+operator with at least one overlapping operator key
 */
function tryMergeAndChildren(
  children: Record<string, unknown>[],
): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  for (const child of children) {
    for (const k of Object.keys(child)) {
      const v = child[k];
      if (!(k in result)) {
        result[k] = v;
        continue;
      }
      const existing = result[k];

      // Two children carrying the same logical operator key → can't merge.
      if (LOGICAL_OPERATORS.has(k)) return null;

      // Both operator objects on a field key → combine if disjoint.
      if (isOperatorObject(existing) && isOperatorObject(v)) {
        const combined: Record<string, unknown> = { ...existing };
        for (const opKey of Object.keys(v)) {
          if (opKey in combined) return null;
          combined[opKey] = v[opKey];
        }
        result[k] = combined;
        continue;
      }

      return null;
    }
  }
  return result;
}

/**
 * Merge `additions` into `out` only if no top-level key collision. Returns
 * true on success. Used by the rule-5 ($and-flatten) and rule-6 ($or/$nor
 * length-1 unwrap) paths, both of which need to fall back to keeping the
 * logical wrapper when a collision would otherwise drop data.
 */
function mergeIfNoConflict(
  out: Record<string, unknown>,
  additions: Record<string, unknown>,
): boolean {
  for (const k of Object.keys(additions)) {
    if (k in out) return false;
  }
  for (const k of Object.keys(additions)) {
    out[k] = additions[k];
  }
  return true;
}

/**
 * Normalize a `ConditionInterface`-shaped object. Applies rules 5–7 to the
 * logical operators encountered at this level and delegates to
 * `normalizeOperatorObject` for field-keyed operator RHSes. Returns a JS
 * object whose canonical string form is produced by `stringifySorted` later.
 */
function normalizeCondition(
  c: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const k of Object.keys(c)) {
    const v = c[k];

    if (k === "$and" && Array.isArray(v)) {
      const children = v
        .map((child) =>
          isPlainObject(child) ? normalizeCondition(child) : null,
        )
        .filter((child): child is Record<string, unknown> => child !== null);

      if (children.length === 0) continue; // empty `$and` → drop (rule 5)

      if (children.length === 1) {
        if (!mergeIfNoConflict(out, children[0])) {
          out[k] = children;
        }
        continue;
      }

      const merged = tryMergeAndChildren(children);
      if (merged && mergeIfNoConflict(out, merged)) continue;

      // Either unmergeable across children, or a collision with `out` (e.g. a
      // prior key at this level). Keep `$and: [...]` with normalized children.
      out[k] = children;
      continue;
    }

    if ((k === "$or" || k === "$nor") && Array.isArray(v)) {
      const children = v
        .map((child) =>
          isPlainObject(child) ? normalizeCondition(child) : null,
        )
        .filter((child): child is Record<string, unknown> => child !== null);

      if (children.length === 0) continue;

      if (children.length === 1) {
        // Rule 6: length-1 unwraps. `$or` becomes its single child (merged
        // into the current level if no conflict); `$nor` becomes `$not`.
        if (k === "$or") {
          if (!mergeIfNoConflict(out, children[0])) out[k] = children;
        } else if (!("$not" in out)) {
          out["$not"] = children[0];
        } else {
          out[k] = children;
        }
        continue;
      }

      children.sort(compareByCanonicalJson);
      out[k] = children;
      continue;
    }

    if (k === "$not") {
      // Rule 7: operand canonicalized recursively; do NOT collapse nested
      // `$not`s into one another (so `$not: {$not: c}` stays as written —
      // canonicalization is structural, not semantic).
      out[k] = isPlainObject(v) ? normalizeCondition(v) : normalizeValue(v);
      continue;
    }

    if (k.startsWith("$")) {
      // Forward-compatible: an unknown top-level operator. Don't pretend to
      // understand its semantics — just normalize its value for stability.
      out[k] = normalizeValue(v);
      continue;
    }

    // Field key. The RHS is either an operator object (`{$gt: 5, $lt: 10}`)
    // or a literal value (implicit `$eq`).
    out[k] = isOperatorObject(v)
      ? normalizeOperatorObject(v)
      : normalizeValue(v);
  }

  return out;
}

/**
 * Produce the canonical JSON representation of a `ConditionInterface`. Two
 * conditions that are equivalent under the 11 normalization rules in the CB
 * MVP plan (A1.1) canonicalize to the same string.
 *
 * Output is compact (no whitespace), object keys are sorted by codepoint,
 * numbers are emitted in shortest round-trip form, strings preserve case +
 * NFC. The empty condition `{}` canonicalizes to `"{}"` — the catch-all leaf
 * gets uniqueness from the CB ID prefix in the hash input, not from the
 * canonical form (rule 11).
 */
export function canonicalize(condition: ConditionInterface): string {
  const normalized = normalizeCondition(
    condition as unknown as Record<string, unknown>,
  );
  return stringifySorted(normalized);
}

/**
 * Derive the stable `contextId` for a `(cbId, condition)` pair.
 *
 * Hash input: `${cbId}|${canonicalize(condition)}`. SHA-256, hex, first 8
 * chars, `"ctx_"` prefix. The CB-id namespace ensures the same condition
 * reused across two experiments produces distinct `contextId`s (CB MVP plan
 * §A5.6 — required for stable warehouse joins across ticks).
 */
export function deriveContextId(
  cbId: string,
  condition: ConditionInterface,
): string {
  return deriveContextIdWithSliceLength(cbId, condition, DEFAULT_HASH_SLICE);
}

/**
 * Slice-length-parameterized variant of `deriveContextId`, intended for the
 * write-time collision-recovery path (CB MVP plan §A1.3 — orchestrator widens
 * the slice from 8 to 12 chars on detected duplicate `contextId`s within a
 * tick). The `"ctx_"` prefix is unchanged regardless of slice length.
 */
export function deriveContextIdWithSliceLength(
  cbId: string,
  condition: ConditionInterface,
  sliceLength: number,
): string {
  if (!Number.isInteger(sliceLength) || sliceLength <= 0 || sliceLength > 64) {
    throw new Error(
      `deriveContextId: sliceLength must be an integer in [1, 64], got ${sliceLength}`,
    );
  }
  const canonical = canonicalize(condition);
  const hashInput = `${cbId}|${canonical}`;
  const hex = createHash("sha256").update(hashInput).digest("hex");
  return `ctx_${hex.slice(0, sliceLength)}`;
}
