import { CONSTANT_EXTENDS_KEY } from "../constants";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Deep-merge `patch` onto `base` for config/constant value resolution. This is
// the "targeted patching" behavior: a descendant (or rule override) restates
// only the leaves it changes.
//
// Rules:
// - Plain objects merge recursively, key by key.
// - Arrays and scalars replace wholesale — arrays are atomic (no element merge).
// - `null` is a value and replaces; it never deletes a key (unlike RFC 7386).
// - A `$extends`-bearing object on either side is a composed chunk and is
//   applied wholesale: the merge never reaches into a `$extends` subtree, so
//   "compose this saved chunk" stays predictable and constants are always
//   applied whole.
export function deepMergePatch(base: unknown, patch: unknown): unknown {
  if (
    !isPlainObject(base) ||
    !isPlainObject(patch) ||
    CONSTANT_EXTENDS_KEY in base ||
    CONSTANT_EXTENDS_KEY in patch
  ) {
    return patch;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = deepMergePatch(base[k], v);
  }
  return out;
}
