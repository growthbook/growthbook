// Arrays keep their order. Key order is an artifact of authoring and merge
// history, so values differing only in it compare equal once sorted.
export function sortObjectKeys(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sortObjectKeys);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortObjectKeys(obj[k]);
    }
    return out;
  }
  return node;
}

const isEmptyValue = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (typeof value === "object" && !Object.keys(value).length);

// Also drops null and empty ("", [], {}) fields like absent ones: the stored,
// sent and rebuilt shapes of a value disagree on which of those they write.
export function canonicalValue(node: unknown): unknown {
  if (node instanceof Date) return node.toISOString();
  if (Array.isArray(node)) return node.map(canonicalValue);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node).sort()) {
      const value = canonicalValue((node as Record<string, unknown>)[k]);
      if (!isEmptyValue(value)) out[k] = value;
    }
    return out;
  }
  return node;
}

export function sameCanonicalValue(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(canonicalValue({ value: a })) ===
    JSON.stringify(canonicalValue({ value: b }))
  );
}
