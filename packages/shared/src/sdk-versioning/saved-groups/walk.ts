import { GroupMap, SavedGroupForPayload } from "shared/types/saved-group";
import { NodeHandler } from "../../util";
import {
  SAVED_GROUP_ERROR_CYCLE,
  SAVED_GROUP_ERROR_INVALID,
  SAVED_GROUP_ERROR_MAX_DEPTH,
  SAVED_GROUP_ERROR_UNKNOWN,
} from "./errors";

// How deep we follow a chain of groups that reference other groups.
export const MAX_SAVED_GROUP_DEPTH = 10;

/**
 * What to do with one entry of a `$savedGroups` array.
 *
 * - `condition`: use this condition.
 * - `skip`: drop it. An empty condition always passes, so it adds nothing.
 * - `invalid`: the whole condition is broken. Stop here.
 */
export type NestedGroupResult =
  | { status: "condition"; condition: Record<string, unknown> }
  | { status: "skip" }
  | { status: "invalid" };

/**
 * Turns one group into a condition. The walker already checked that the group
 * exists and is not part of a cycle, so this only handles the normal case.
 */
export type NestedGroupRenderer = (args: {
  groupId: string;
  group: SavedGroupForPayload;
  groupMap: GroupMap;
  visited: Set<string>;
  depth: number;
}) => NestedGroupResult;

/**
 * Rewrites the `$savedGroups` operator wherever it appears in a stored
 * condition. `$savedGroups` holds a list of group ids that must all match, and
 * it never reaches an SDK. Each group becomes a condition, and those get ANDed
 * into the condition the operator was found on.
 *
 * This works the same for every format. The checks below (depth, cycles,
 * unknown ids) never change; `nestedGroup` supplies the part that does.
 */
export function walkSavedGroups(
  groupMap: GroupMap,
  nestedGroup: NestedGroupRenderer,
  {
    visited = new Set<string>(),
    depth = 0,
  }: { visited?: Set<string>; depth?: number } = {},
): NodeHandler {
  return ([key, value], object) => {
    if (key !== "$savedGroups") return;

    delete object.$savedGroups;

    const newConditions: unknown[] = [];

    if (depth >= MAX_SAVED_GROUP_DEPTH) {
      // Gracefully truncate: replace with condition that is always false
      // This prevents infinite recursion and deep nesting issues
      newConditions.push({ [SAVED_GROUP_ERROR_MAX_DEPTH]: true });
    }

    const savedGroupValues = Array.isArray(value) ? value : [value];
    for (const groupId of savedGroupValues) {
      if (depth >= MAX_SAVED_GROUP_DEPTH) {
        // Prevent infinite recursion
        continue;
      }
      if (!groupId || typeof groupId !== "string") continue;

      // Prevent cycles
      if (visited.has(groupId)) {
        // Cycle detected - replace with always-false condition
        // Break out of the loop since the entire condition is already invalid
        newConditions.push({ [SAVED_GROUP_ERROR_CYCLE]: groupId });
        break;
      }

      const group = groupMap.get(groupId);
      if (!group) {
        // Unknown group, replace with always-false condition
        newConditions.push({ [SAVED_GROUP_ERROR_UNKNOWN]: groupId });
        break;
      }

      const result = nestedGroup({ groupId, group, groupMap, visited, depth });

      if (result.status === "invalid") {
        newConditions.push({ [SAVED_GROUP_ERROR_INVALID]: groupId });
        break;
      }
      if (result.status === "condition") {
        newConditions.push(result.condition);
      }
    }

    // If nothing to add, return early
    if (!newConditions.length) return;

    // Combine existing condition with new conditions using AND
    const and: unknown[] = [];

    // Add existing conditions (if any) to a new object within $and
    const existingCond: Record<string, unknown> = {};
    for (const k in object) {
      // Existing $and - flatten into the new $and array
      if (k === "$and") {
        // Valid $and - array of condition
        if (Array.isArray(object["$and"])) {
          object["$and"].forEach((cond: unknown) => {
            and.push(cond);
          });
        }
        // Invalid $and - not an array, keep as-is
        else {
          and.push({ $and: object["$and"] });
        }
      }
      // Otherwise, add to existingCond
      else {
        existingCond[k] = object[k];
      }
    }
    if (Object.keys(existingCond).length > 0) {
      and.push(existingCond);
    }

    // Add all new conditions from saved groups
    newConditions.forEach((cond) => {
      // Sanity check - this should never be false
      if (cond && typeof cond === "object") {
        and.push(cond);
      }
    });

    // Remove invalid entries and flatten into final AND
    const finalAnd: Record<string, unknown>[] = [];
    and.forEach((cond: unknown) => {
      // Skip conditions that are not objects or empty
      if (!cond || typeof cond !== "object" || Object.keys(cond).length === 0) {
        return;
      }

      // Object with a single key "$and"
      // Flatten into top-level $and
      if (
        Object.keys(cond).length === 1 &&
        "$and" in cond &&
        Array.isArray(cond["$and"])
      ) {
        cond["$and"].forEach((nestedCond: unknown) => {
          if (
            nestedCond &&
            typeof nestedCond === "object" &&
            Object.keys(nestedCond).length > 0
          ) {
            finalAnd.push(nestedCond as Record<string, unknown>);
          }
        });
      }
      // Otherwise, keep the condition as-is
      else {
        finalAnd.push(cond as Record<string, unknown>);
      }
    });

    // Remove all existing keys from object
    for (const k in object) {
      delete object[k];
    }

    // If $and has only one condition, flatten it and add each key directly
    if (finalAnd.length === 1) {
      const singleCond = finalAnd[0];
      for (const k in singleCond) {
        object[k] = singleCond[k];
      }
    }
    // Otherwise set $and to the combined conditions
    else {
      object["$and"] = finalAnd;
    }
  };
}
