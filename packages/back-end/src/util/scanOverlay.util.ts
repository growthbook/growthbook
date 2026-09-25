/**
 * Substitute proposed entity states into a loaded snapshot — the read-side
 * primitive behind the bulk publisher's hypothetical end-state overlay
 * (ConfigModel/ConstantModel.setScanOverlay and the feature loader's
 * featureScanOverlay). Docs whose id appears in the overlay are replaced;
 * overlay docs not present in the snapshot are appended. Returns the input
 * array untouched when there is no overlay. The optional projector keeps
 * overlaid documents consistent with a projected database read.
 */
export function overlayDocsById<T extends { id: string }, S extends T = T>(
  docs: T[],
  overlay: Map<string, S> | null | undefined,
  project: (doc: S) => T = (doc) => doc,
): T[] {
  if (!overlay?.size) return docs;
  const seen = new Set<string>();
  const merged = docs.map((doc) => {
    seen.add(doc.id);
    const proposed = overlay.get(doc.id);
    return proposed ? project(proposed) : doc;
  });
  for (const [id, doc] of overlay) {
    if (!seen.has(id)) merged.push(project(doc));
  }
  return merged;
}
