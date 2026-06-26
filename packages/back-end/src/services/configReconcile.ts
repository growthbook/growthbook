import {
  getConfigSubtree,
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
} from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";

/**
 * Re-run "base wins" normalization across every descendant of `rootKey` after
 * that config's schema changes.
 *
 * When a base (ancestor) config publishes a new field, any descendant that had
 * already declared that key must drop its own definition: the ancestor now owns
 * it, and the descendant keeps only a value override. We walk the subtree base
 * → leaf so each node is reconciled against an already-normalized ancestor set,
 * and apply each strip as a system write (`dangerousUpdateBypassPermission`) so
 * the cascade isn't blocked by per-config/per-project edit permissions — the
 * acting user only published the base.
 *
 * The root itself is skipped: it's normalized against its own ancestors on its
 * primary write (see ConfigModel.normalizeSchemaAgainstAncestors).
 */
export async function reconcileConfigDescendants(
  context: Context,
  rootKey: string,
): Promise<void> {
  const all = await context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));

  for (const key of getConfigSubtree(rootKey, all)) {
    if (key === rootKey) continue;
    const node = byKey.get(key);
    if (!node) continue;

    const ancestorKeys = getAncestorSchemaKeys(node, byKey);
    const kept = stripAncestorOwnedFields(node.schema, ancestorKeys);
    if (!kept) continue;

    const newSchema = {
      ...node.schema,
      type: node.schema?.type ?? ("object" as const),
      fields: kept,
    };
    const updated =
      await context.models.configs.dangerousUpdateBypassPermission(node, {
        schema: newSchema,
      });
    // Keep the working map current so a deeper descendant sees the parent's
    // post-strip schema when computing its own ancestor-owned keys.
    byKey.set(updated.key, updated);
  }
}
