import { GroupMap } from "shared/types/saved-group";
import { recursiveWalk } from "../../util";

/**
 * Returns the given group ids plus every group they reference, at any depth.
 * A condition group's condition can name more groups, so following one id can
 * turn up several. Ids already found are never followed twice, so loops stop.
 *
 * For example:
 *
 *   grp_a  (condition)  {"$savedGroups": ["grp_b"]}
 *   grp_b  (condition)  {"id": {"$inGroup": "grp_c"}}
 *   grp_c  (list)
 *
 *   findAllReferencedSavedGroupIds(["grp_a"], groupMap)
 *     -> Set {"grp_a", "grp_b", "grp_c"}
 */
export function findAllReferencedSavedGroupIds(
  seedIds: Iterable<string>,
  savedGroups: GroupMap,
): Set<string> {
  const resolved = new Set<string>();
  const queue = Array.from(seedIds);

  while (queue.length) {
    const id = queue.shift() as string;
    if (resolved.has(id)) continue;
    resolved.add(id);

    const group = savedGroups.get(id);
    if (group?.type !== "condition" || !group.condition) continue;

    try {
      const condition = JSON.parse(group.condition);
      recursiveWalk(condition, ([key, value]) => {
        // Stored conditions use `$savedGroups`, a list of ids. Conditions
        // already built for a payload use one id per operator.
        if (key === "$savedGroups") {
          (Array.isArray(value) ? value : [value]).forEach((v) => {
            if (typeof v === "string") queue.push(v);
          });
        } else if (
          key === "$savedGroup" ||
          key === "$inGroup" ||
          key === "$notInGroup"
        ) {
          if (typeof value === "string") queue.push(value);
        }
      });
    } catch (e) {
      // Bad JSON means no ids to follow.
    }
  }

  return resolved;
}
