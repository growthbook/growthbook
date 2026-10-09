import { SavedGroupForPayload } from "shared/types/saved-group";
import { recursiveWalk } from "../../util";

/**
 * The id inside a `$savedGroup` operator, or null if it is not a reference.
 * Missing one drops a group from the payload map, and every reference to it
 * then matches nobody.
 */
export function readSavedGroupReferenceId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Calls `fn` with every group id a parsed condition references, in any of the
 * operator forms and at any depth. Ids may repeat.
 */
export function forEachSavedGroupIdInCondition(
  condition: unknown,
  fn: (id: string) => void,
): void {
  recursiveWalk(condition, ([key, value]) => {
    // Stored conditions use `$savedGroups`, a list of ids. Conditions
    // already built for a payload use one id per operator.
    if (key === "$savedGroups") {
      (Array.isArray(value) ? value : [value]).forEach((v) => {
        if (typeof v === "string") fn(v);
      });
    } else if (key === "$savedGroup") {
      const id = readSavedGroupReferenceId(value);
      if (id) fn(id);
    } else if (key === "$inGroup" || key === "$notInGroup") {
      if (typeof value === "string") fn(value);
    }
  });
}

/**
 * The group ids a rule's targeting names directly: its saved group list, its
 * condition and its prerequisites' conditions. A malformed condition names
 * none.
 */
export function savedGroupIdsInTargeting(targeting: {
  condition?: string;
  savedGroups?: { ids: string[] }[];
  prerequisites?: { condition: string }[];
}): string[] {
  const ids = new Set<string>();
  for (const entry of targeting.savedGroups ?? []) {
    entry.ids.forEach((id) => ids.add(id));
  }
  const conditions = [
    targeting.condition,
    ...(targeting.prerequisites ?? []).map((p) => p.condition),
  ];
  for (const condition of conditions) {
    if (!condition) continue;
    try {
      forEachSavedGroupIdInCondition(JSON.parse(condition), (id) =>
        ids.add(id),
      );
    } catch {
      // Bad JSON means no ids
    }
  }
  return [...ids];
}

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
  savedGroups: Map<string, Pick<SavedGroupForPayload, "type" | "condition">>,
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
      forEachSavedGroupIdInCondition(JSON.parse(group.condition), (id) =>
        queue.push(id),
      );
    } catch (e) {
      // Bad JSON means no ids to follow.
    }
  }

  return resolved;
}
