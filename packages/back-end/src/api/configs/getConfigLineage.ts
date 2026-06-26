import { getConfigLineageValidator } from "shared/validators";
import { getConfigParentKey, getConfigSubtree } from "shared/util";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";

export const getConfigLineage = createApiRequestHandler(
  getConfigLineageValidator,
)(async (req) => {
  const config = await req.context.models.configs.getByKey(req.params.key);
  if (!config) {
    throw new NotFoundError("Could not find config with that key");
  }

  // Lineage spans projects (an ancestor/descendant may live in a project the
  // caller can't read), so build the family from the unfiltered set. Read access
  // is gated above by `getByKey`, which respects per-config read permissions.
  const all = await req.context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));

  // Walk up to the root, collecting the target's ancestor chain (root-first).
  const ancestors: string[] = [];
  const seen = new Set<string>([config.key]);
  let parentKey = getConfigParentKey(config);
  while (parentKey && byKey.has(parentKey) && !seen.has(parentKey)) {
    seen.add(parentKey);
    ancestors.unshift(parentKey);
    parentKey = getConfigParentKey(byKey.get(parentKey)!);
  }
  const root = ancestors.length ? ancestors[0] : config.key;

  // The whole family is the root plus its entire subtree (BFS, root-first).
  const familyKeys = getConfigSubtree(root, all);

  // Depth from the root. BFS order guarantees a parent precedes its children.
  const depth = new Map<string, number>();
  const nodes = familyKeys.flatMap((key) => {
    const c = byKey.get(key);
    if (!c) return [];
    const p = getConfigParentKey(c);
    const d = key === root ? 0 : (depth.get(p ?? "") ?? 0) + 1;
    depth.set(key, d);
    return [
      {
        key: c.key,
        name: c.name,
        parent: p,
        ...(c.project ? { project: c.project } : {}),
        archived: !!c.archived,
        depth: d,
        isTarget: key === config.key,
      },
    ];
  });

  const descendants = getConfigSubtree(config.key, all).filter(
    (k) => k !== config.key,
  );

  return { root, target: config.key, ancestors, descendants, nodes };
});
