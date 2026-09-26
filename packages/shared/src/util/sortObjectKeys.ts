/**
 * A JSON clone with object keys sorted recursively; arrays keep their order.
 * Key order is an artifact of authoring and merge history, so two values that
 * differ only in it compare equal once both are sorted.
 */
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
