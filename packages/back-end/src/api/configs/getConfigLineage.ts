import { getConfigLineageValidator } from "shared/validators";
import {
  getConfigParentKey,
  getConfigSubtree,
  getConfigSpineSubtree,
  getConfigSpineRootKey,
  linearizeConfigDag,
  resolveConfigChain,
  configIsExtensible,
  findIncompatibleConfigValueKeys,
  parsePlainJSONObject,
} from "shared/util";
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
  //
  // NOTE (intentional disclosure): once a caller can read the target config, the
  // returned tree includes the keys/names/field-counts of cross-project lineage
  // members they may not independently have read access to. This is by design —
  // lineage is meaningless without the full family — but it does surface metadata
  // (not values) of related configs across project boundaries.
  const all = await req.context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));

  // Own value keys that no longer conform to a node's effective schema.
  const incompatibleFieldsFor = (nodeKey: string): string[] => {
    const node = byKey.get(nodeKey);
    if (!node) return [];
    const fields = resolveConfigChain(
      linearizeConfigDag(nodeKey, byKey),
    ).effectiveSchema;
    const spineRoot = byKey.get(getConfigSpineRootKey(nodeKey, byKey));
    const additionalProperties = configIsExtensible(
      spineRoot,
      req.context.org.settings?.configsExtensibleByDefault,
    );
    // Union over the default value AND every environment override — a stale prod
    // value must get the "must fix" flag even when the default conforms.
    const incompatible = new Set<string>();
    for (const raw of [
      node.value,
      ...Object.values(node.environmentValues ?? {}),
    ]) {
      const obj = parsePlainJSONObject(raw ?? "");
      if (!obj) continue;
      for (const k of findIncompatibleConfigValueKeys({
        value: obj,
        fields,
        additionalProperties,
      })) {
        incompatible.add(k);
      }
    }
    return [...incompatible];
  };

  // Walk up the `parent` spine to the root, collecting the ancestor chain
  // (root-first). The tree shape follows `parent`; mixins are carried per-node
  // in `extends`.
  const ancestors: string[] = [];
  const seen = new Set<string>([config.key]);
  let parentKey = getConfigParentKey(config);
  while (parentKey && byKey.has(parentKey) && !seen.has(parentKey)) {
    seen.add(parentKey);
    ancestors.unshift(parentKey);
    parentKey = getConfigParentKey(byKey.get(parentKey)!);
  }
  const root = ancestors.length ? ancestors[0] : config.key;

  // The whole family is the spine root plus its `parent`-spine subtree (the tree
  // shape follows `parent`; mixins are carried per-node in `extends`, not as
  // separate branches, so descent must not pull in cross-family composers).
  // BFS, root-first.
  const familyKeys = getConfigSpineSubtree(root, all);

  // Depth from the root along the `parent` spine. BFS order guarantees a parent
  // precedes its children.
  const depth = new Map<string, number>();
  const nodes = familyKeys.flatMap((key) => {
    const c = byKey.get(key);
    if (!c) return [];
    const p = getConfigParentKey(c);
    const d = key === root ? 0 : (depth.get(p ?? "") ?? 0) + 1;
    depth.set(key, d);
    const incompatibleFields = incompatibleFieldsFor(c.key);
    return [
      {
        key: c.key,
        name: c.name,
        parent: p,
        extends: c.extends ?? [],
        ...(c.project ? { project: c.project } : {}),
        archived: !!c.archived,
        depth: d,
        isTarget: key === config.key,
        ...(incompatibleFields.length ? { incompatibleFields } : {}),
      },
    ];
  });

  const descendants = getConfigSubtree(config.key, all).filter(
    (k) => k !== config.key,
  );

  return { root, target: config.key, ancestors, descendants, nodes };
});
