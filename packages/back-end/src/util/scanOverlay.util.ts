/**
 * Substitute proposed entity states into a loaded snapshot — the read-side
 * primitive behind the bulk publisher's hypothetical end-state overlay
 * (ConfigModel/ConstantModel.setScanOverlay and the feature loader's
 * featureScanOverlay). Docs whose id appears in the overlay are replaced;
 * overlay docs not present in the snapshot are appended. Returns the input
 * array untouched when there is no overlay.
 */
export function overlayDocsById<T extends { id: string }>(
  docs: T[],
  overlay: Map<string, T> | null | undefined,
): T[] {
  if (!overlay?.size) return docs;
  const seen = new Set<string>();
  const merged = docs.map((doc) => {
    seen.add(doc.id);
    return overlay.get(doc.id) ?? doc;
  });
  for (const [id, doc] of overlay) {
    if (!seen.has(id)) merged.push(doc);
  }
  return merged;
}
