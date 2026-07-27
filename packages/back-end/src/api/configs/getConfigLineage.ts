import { getConfigLineageValidator } from "shared/validators";
import {
  getConfigParentKey,
  getConfigSubtree,
  getConfigSpineSubtree,
  linearizeConfigDag,
  resolveConfigChain,
  findIncompatibleConfigValueKeys,
  findOrphanedConfigValueKeys,
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

  // Build the family from the unfiltered set since lineage can span projects the
  // caller can't read (read access to the target was gated above by `getByKey`) —
  // resolution/depth would silently truncate otherwise. Node METADATA is then
  // filtered to readable projects below, matching the internal lineage view:
  // bare keys of unreadable members remain (structure needs them, and the
  // internal view exposes them via parentKey), names/projects/flags do not.
  const all = await req.context.models.configs.getAllForReconcile();
  const byKey = new Map(all.map((c) => [c.key, c]));

  // Own value keys that no longer conform to a node's effective schema
  // (`incompatible`) or that it no longer declares at all (`orphaned` — what an
  // ancestor's field removal leaves behind).
  const valueFlagsFor = (
    nodeKey: string,
  ): { incompatibleFields: string[]; orphanedFields: string[] } => {
    const node = byKey.get(nodeKey);
    if (!node) return { incompatibleFields: [], orphanedFields: [] };
    const fields = resolveConfigChain(
      linearizeConfigDag(nodeKey, byKey),
    ).effectiveSchema;
    const incompatible = new Set<string>();
    const orphaned = new Set<string>();
    for (const raw of [node.value]) {
      const obj = parsePlainJSONObject(raw ?? "");
      if (!obj) continue;
      for (const k of findIncompatibleConfigValueKeys({
        value: obj,
        fields,
      })) {
        incompatible.add(k);
      }
      for (const k of findOrphanedConfigValueKeys({ value: obj, fields })) {
        orphaned.add(k);
      }
    }
    return {
      incompatibleFields: [...incompatible],
      orphanedFields: [...orphaned],
    };
  };

  // Walk up the `parent` spine to the root, ancestors root-first.
  const ancestors: string[] = [];
  const seen = new Set<string>([config.key]);
  let parentKey = getConfigParentKey(config);
  while (parentKey && byKey.has(parentKey) && !seen.has(parentKey)) {
    seen.add(parentKey);
    ancestors.unshift(parentKey);
    parentKey = getConfigParentKey(byKey.get(parentKey)!);
  }
  const root = ancestors.length ? ancestors[0] : config.key;

  // Family = the spine root plus its `parent`-spine subtree. Descent follows
  // `parent` only; mixins (`extends`) must not pull in cross-family composers.
  const familyKeys = getConfigSpineSubtree(root, all);

  // BFS order guarantees a parent precedes its children.
  const depth = new Map<string, number>();
  const nodes = familyKeys.flatMap((key) => {
    const c = byKey.get(key);
    if (!c) return [];
    const p = getConfigParentKey(c);
    const d = key === root ? 0 : (depth.get(p ?? "") ?? 0) + 1;
    // Depth is computed for every family member (children of an unreadable
    // middle node still need its depth) before unreadable nodes are dropped.
    depth.set(key, d);
    if (!req.context.permissions.canReadSingleProjectResource(c.project)) {
      return [];
    }
    const { incompatibleFields, orphanedFields } = valueFlagsFor(c.key);
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
        ...(orphanedFields.length ? { orphanedFields } : {}),
      },
    ];
  });

  // Descendant keys are pure disclosure (nothing structural hangs off them), so
  // unlike ancestor keys they're filtered to readable projects outright.
  const descendants = getConfigSubtree(config.key, all).filter(
    (k) =>
      k !== config.key &&
      req.context.permissions.canReadSingleProjectResource(
        byKey.get(k)?.project,
      ),
  );

  return { root, target: config.key, ancestors, descendants, nodes };
});
