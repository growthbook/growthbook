import type { ConditionInterface } from "@growthbook/growthbook";
import { OrganizationInterface } from "shared/types/organization";
import { GroupMap, SavedGroupForPayload } from "shared/types/saved-group";
import {
  getSavedGroupsValuesFromInterfaces,
  NodeHandler,
  recursiveWalk,
} from "../../util";
import { SavedGroupPayloadStrategy } from "./types";
import { NestedGroupRenderer, walkSavedGroups } from "./walk";

/**
 * Builds the condition for one saved group. List groups become `$inGroup` or
 * `$notInGroup`. Condition groups have no reference form in v1, so their
 * condition goes inline.
 */
export function createV1Condition({
  groupId,
  group,
  include,
}: {
  groupId: string;
  group: SavedGroupForPayload;
  include: boolean;
}): ConditionInterface | null {
  if (group.type === "condition" && group.condition) {
    try {
      const cond = JSON.parse(group.condition);
      return include ? cond : { $not: cond };
    } catch (e) {
      return null;
    }
  }

  if (!group.attributeKey) return null;

  return {
    [group.attributeKey]: { [include ? "$inGroup" : "$notInGroup"]: groupId },
  };
}

/** Builds the condition for one entry of a `$savedGroups` array. */
const createV1NestedCondition: NestedGroupRenderer = ({
  groupId,
  group,
  groupMap,
  visited,
  depth,
}) => {
  if (group.type === "list") {
    // A list group with no attributeKey cannot be used.
    if (!group.attributeKey) return { status: "invalid" };
    return {
      status: "condition",
      condition: { [group.attributeKey]: { $inGroup: groupId } },
    };
  }

  // An empty condition always passes, so it adds nothing.
  if (!group.condition || group.condition === "{}") return { status: "skip" };

  try {
    const cond = JSON.parse(group.condition);

    const newVisited = new Set(visited);
    newVisited.add(groupId);

    // This group's condition may name more groups, so go one level deeper.
    recursiveWalk(
      cond,
      walkSavedGroups(groupMap, createV1NestedCondition, {
        visited: newVisited,
        depth: depth + 1,
      }),
    );

    if (!cond || Object.keys(cond).length === 0) return { status: "skip" };
    return { status: "condition", condition: cond };
  } catch (e) {
    return { status: "invalid" };
  }
};

/**
 * Returns a handler that rewrites `$savedGroups` into v1 operators, following
 * condition groups down. Also used to validate a condition while someone edits
 * it, since the handler marks cycles and missing groups.
 */
export function createV1SavedGroupsOperatorHandler(
  groupMap: GroupMap,
): NodeHandler {
  return walkSavedGroups(groupMap, createV1NestedCondition);
}

/**
 * Builds the strategy that sends ID lists by reference, looked up in a map of
 * plain value arrays. Condition groups have no reference form, so they go
 * inline.
 */
export function createReferencesV1Strategy(
  groupMap: GroupMap,
  organization?: OrganizationInterface,
): SavedGroupPayloadStrategy {
  return {
    rendering: "referencesV1",
    groupMap,
    createCondition: ({ groupId, include }) => {
      const group = groupMap.get(groupId);
      if (!group) return null;
      return createV1Condition({ groupId, group, include });
    },
    createSavedGroupsOperatorHandler: () =>
      createV1SavedGroupsOperatorHandler(groupMap),
    finalizeCondition: () => undefined,
    buildSavedGroupsPayload: (usedSavedGroups) =>
      organization
        ? getSavedGroupsValuesFromInterfaces(usedSavedGroups, organization)
        : undefined,
  };
}
