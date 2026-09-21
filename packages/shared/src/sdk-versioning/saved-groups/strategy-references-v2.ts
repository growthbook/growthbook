import type { ConditionInterface } from "@growthbook/growthbook";
import { OrganizationInterface } from "shared/types/organization";
import {
  GroupMap,
  SavedGroupForPayload,
  SavedGroupInterface,
  SavedGroupPayloadEntry,
  SavedGroupPayloadMap,
  SavedGroupType,
} from "shared/types/saved-group";
import {
  getSavedGroupValueType,
  getTypedSavedGroupValues,
  NodeHandler,
  recursiveWalk,
} from "../../util";
import { SDKCapability } from "../types";
import { SAVED_GROUP_ERROR_INVALID, SAVED_GROUP_ERROR_UNKNOWN } from "./errors";
import { SavedGroupPayloadStrategy } from "./types";
import {
  andConditionsInto,
  NestedGroupRenderer,
  walkSavedGroups,
} from "./walk";

// The capability an SDK needs before we send a group of this type by
// reference. Keyed by SavedGroupType, so adding a new type without gating it
// is a compile error.
export const SAVED_GROUP_TYPE_CAPABILITY: Record<
  SavedGroupType,
  SDKCapability
> = {
  list: "savedGroupReferencesV2",
  condition: "savedGroupReferencesV2",
};

/**
 * Builds a `$savedGroup` reference, negated when `include` is false.
 *
 * `attributeKey` is only passed when it differs from the entry's own, so the
 * common case has one spelling.
 */
function createGroupReference(
  groupId: string,
  include: boolean,
  attributeKey?: string,
): ConditionInterface {
  const ref = {
    $savedGroup: attributeKey ? { id: groupId, attributeKey } : { id: groupId },
  };
  return include ? ref : { $not: ref };
}

/** Builds the condition for one saved group: a reference, whatever its type. */
function createV2Condition({
  groupId,
  group,
  include,
}: {
  groupId: string;
  group: SavedGroupForPayload;
  include: boolean;
}): ConditionInterface | null {
  if (group.type === "condition" && group.condition) {
    // Parsed only to catch bad JSON. The payload map leaves out a group it
    // cannot parse, so we must not reference one here either.
    try {
      JSON.parse(group.condition);
    } catch (e) {
      return null;
    }
    return createGroupReference(groupId, include);
  }

  if (!group.attributeKey) return null;

  return createGroupReference(groupId, include);
}

/**
 * Builds the condition for one entry of a `$savedGroups` array. Nothing goes
 * deeper, since the SDK looks each reference up in the payload itself.
 */
const createV2NestedCondition: NestedGroupRenderer = ({ groupId, group }) => {
  if (group.type === "list") {
    if (!group.attributeKey) return { status: "invalid" };
    return { status: "condition", condition: { $savedGroup: { id: groupId } } };
  }

  if (!group.condition || group.condition === "{}") return { status: "skip" };

  try {
    // Parsed only to catch bad JSON, same as above.
    JSON.parse(group.condition);
  } catch (e) {
    return { status: "invalid" };
  }

  return { status: "condition", condition: { $savedGroup: { id: groupId } } };
};

/** Returns a handler that rewrites `$savedGroups` into `$savedGroup`. */
export function createV2SavedGroupsOperatorHandler(
  groupMap: GroupMap,
): NodeHandler {
  return walkSavedGroups(groupMap, createV2NestedCondition);
}

/** The v1 operators, and whether each one means "in the group". */
const LEGACY_OPERATOR_INCLUDES = {
  $inGroup: true,
  $notInGroup: false,
} as const;

/**
 * Builds the always-false stand-in for a reference with no v2 equivalent: a
 * Condition Group, or an id that is not in the map.
 *
 * The marker is an operator no SDK knows, so it matches nobody. `$notInGroup`
 * is negated on top of it, which keeps today's behaviour of passing everyone
 * rather than flipping to passing nobody.
 */
function markerFor(
  groupId: string,
  groupExists: boolean,
  include: boolean,
): ConditionInterface {
  const marker = {
    [groupExists ? SAVED_GROUP_ERROR_INVALID : SAVED_GROUP_ERROR_UNKNOWN]:
      groupId,
  };
  return include ? marker : { $not: marker };
}

/**
 * Rewrites `$inGroup` and `$notInGroup` into `$savedGroup` references, in
 * place, so a v2 payload carries no v1 operators at all. For example:
 *
 *   {"id": {"$inGroup": "grp_beta"}, "country": "US"}
 *     ->  {"$and": [{"country": "US"}, {"$savedGroup": {"id": "grp_beta"}}]}
 *
 * The attribute the operator sits under wins over the entry's own, carried as
 * an `attributeKey` override when the two differ.
 *
 * A reference with no equivalent — a Condition Group, or an id that is not in
 * the map — becomes an error marker instead. See `markerFor`.
 */
export function rewriteLegacySavedGroupOperators(
  node: unknown,
  groupMap: GroupMap,
): void {
  if (Array.isArray(node)) {
    node.forEach((child) => rewriteLegacySavedGroupOperators(child, groupMap));
    return;
  }
  if (!node || typeof node !== "object") return;

  const object = node as Record<string, unknown>;

  // Children first. Rewriting this object rebuilds its keys, which would put
  // an unvisited sibling out of reach.
  Object.values(object).forEach((child) =>
    rewriteLegacySavedGroupOperators(child, groupMap),
  );

  const references: ConditionInterface[] = [];

  for (const [field, value] of Object.entries(object)) {
    // These operators always sit under an attribute name
    if (field.startsWith("$")) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const operators = value as Record<string, unknown>;

    for (const [operator, include] of Object.entries(
      LEGACY_OPERATOR_INCLUDES,
    )) {
      const groupId = operators[operator];
      if (typeof groupId !== "string") continue;

      delete operators[operator];

      const group = groupMap.get(groupId);
      // Only an ID List has values for these operators to compare against, and
      // only one with an `attributeKey` reaches the payload map at all.
      if (group?.type === "list" && group.attributeKey) {
        references.push(
          createGroupReference(
            groupId,
            include,
            // The condition's own attribute wins, so only record the override
            // when it is not the entry's.
            group.attributeKey === field ? undefined : field,
          ),
        );
      } else {
        references.push(markerFor(groupId, group !== undefined, include));
      }
    }

    if (!Object.keys(operators).length) delete object[field];
  }

  if (references.length) andConditionsInto(object, references);
}

/** Builds the `savedGroups` field of a savedGroupReferencesV2 payload. */
export function buildV2SavedGroupsPayload(
  savedGroups: SavedGroupInterface[],
  organization: Pick<OrganizationInterface, "settings">,
  groupMap: GroupMap,
): SavedGroupPayloadMap {
  const payload: SavedGroupPayloadMap = {};

  for (const group of savedGroups) {
    const entry = buildV2PayloadEntry(group, organization, groupMap);
    if (entry) payload[group.id] = entry;
  }

  return payload;
}

/** Builds the payload entry for one saved group, or null if it is unusable. */
function buildV2PayloadEntry(
  group: SavedGroupInterface,
  organization: Pick<OrganizationInterface, "settings">,
  groupMap: GroupMap,
): SavedGroupPayloadEntry | null {
  switch (group.type) {
    case "list": {
      // Unused fields are saved as empty strings, so a missing attributeKey
      // arrives as "". Sending that would have the SDK check no attribute at
      // all, so leave the group out instead.
      if (!group.attributeKey || !group.values) return null;
      return {
        type: "list",
        attributeKey: group.attributeKey,
        values: getTypedSavedGroupValues(
          group.values,
          getSavedGroupValueType(group, organization),
        ),
      };
    }
    case "condition": {
      if (!group.condition) return null;
      try {
        const condition = JSON.parse(group.condition);
        // Rewrite any `$savedGroups` inside this condition into `$savedGroup`,
        // so the stored form never reaches an SDK.
        recursiveWalk(condition, createV2SavedGroupsOperatorHandler(groupMap));
        rewriteLegacySavedGroupOperators(condition, groupMap);
        return { type: "condition", condition };
      } catch (e) {
        return null;
      }
    }
  }
}

/**
 * Builds the strategy that sends every group as a `$savedGroup` reference,
 * looked up in a map of typed entries.
 */
export function createReferencesV2Strategy(
  groupMap: GroupMap,
  capabilities: SDKCapability[],
  organization?: OrganizationInterface,
): SavedGroupPayloadStrategy {
  return {
    rendering: "referencesV2",
    groupMap,
    createCondition: ({ groupId, include }) => {
      const group = groupMap.get(groupId);
      if (!group) return null;
      return createV2Condition({ groupId, group, include });
    },
    createSavedGroupsOperatorHandler: () =>
      createV2SavedGroupsOperatorHandler(groupMap),
    finalizeCondition: (condition) =>
      rewriteLegacySavedGroupOperators(condition, groupMap),
    buildSavedGroupsPayload: (usedSavedGroups) =>
      organization
        ? buildV2SavedGroupsPayload(
            // Leave out any group type this SDK cannot read.
            usedSavedGroups.filter((g) =>
              capabilities.includes(SAVED_GROUP_TYPE_CAPABILITY[g.type]),
            ),
            organization,
            new Map(usedSavedGroups.map((g) => [g.id, g])),
          )
        : undefined,
  };
}
