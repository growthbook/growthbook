import { OrganizationInterface } from "shared/types/organization";
import { GroupMap } from "shared/types/saved-group";
import {
  getSavedGroupValueType,
  getTypedSavedGroupValues,
  NodeHandler,
  recursiveWalk,
} from "../../util";
// Inlining builds the same conditions as v1, then rewrites them below.
import {
  createV1SavedGroupsOperatorHandler,
  createV1Condition,
} from "./strategy-references-v1";
import { SavedGroupPayloadStrategy } from "./types";

/** The value operator each reference operator becomes when inlined. */
const savedGroupOperatorReplacements = {
  $inGroup: "$in",
  $notInGroup: "$nin",
};

/**
 * Returns a handler that swaps `$inGroup` and `$notInGroup` for `$in` and
 * `$nin` with the group's values. An unknown group becomes an empty list.
 */
function createInGroupOperatorHandler(
  groupMap: GroupMap,
  organization: Pick<OrganizationInterface, "settings">,
): NodeHandler {
  return ([key, value], object) => {
    if (key === "$inGroup" || key === "$notInGroup") {
      const group = groupMap.get(value);

      const values = group
        ? getTypedSavedGroupValues(
            group.values || [],
            getSavedGroupValueType(group, organization),
          )
        : [];
      object[savedGroupOperatorReplacements[key]] = values;

      delete object[key];
    }
  };
}

/**
 * Builds the strategy that puts each group's values directly into the
 * conditions. The payload has no `savedGroups` field, so the SDK never looks
 * anything up.
 */
export function createInlineStrategy(
  groupMap: GroupMap,
  organization: OrganizationInterface,
): SavedGroupPayloadStrategy {
  return {
    rendering: "inline",
    groupMap,
    createCondition: ({ groupId, include }) => {
      const group = groupMap.get(groupId);
      if (!group) return null;
      return createV1Condition({ groupId, group, include });
    },
    createSavedGroupsOperatorHandler: () =>
      createV1SavedGroupsOperatorHandler(groupMap),
    finalizeCondition: (condition) =>
      recursiveWalk(
        condition,
        createInGroupOperatorHandler(groupMap, organization),
      ),
    buildSavedGroupsPayload: () => undefined,
  };
}
