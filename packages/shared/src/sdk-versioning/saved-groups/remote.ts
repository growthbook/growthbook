import type { ConditionInterface } from "@growthbook/growthbook";
import { REMOTE_GROUP_IDS_ATTRIBUTE } from "shared/constants";
import { GroupMap, SavedGroupForPayload } from "shared/types/saved-group";
import { SavedGroupFormat } from "shared/types/sdk-connection";
import { NodeHandler, recursiveWalk } from "../../util";
import { SDKCapability } from "../types";
import { SAVED_GROUP_ERROR_INVALID } from "./errors";
import {
  findAllReferencedSavedGroupIds,
  readSavedGroupReferenceId,
} from "./referenced-ids";
import { SAVED_GROUP_TYPE_CAPABILITY } from "./strategy-references-v2";
import { SavedGroupPayloadStrategy } from "./types";
import { andConditionsInto } from "./walk";

/*
 * Remote saved groups in SDK payloads.
 *
 * A remote group's IDs aren't in the payload. SDKs check the user's
 * `__remoteGroupIds` attribute instead, which a resolver sets. Remote groups
 * are handled around the format strategies, not inside them:
 *
 * - Before a strategy sees a condition, remote groups are rewritten for the
 *   SDK: `attribute` mode writes attribute conditions on `__remoteGroupIds`,
 *   for SDKs without savedGroupReferencesRemote; `referenceV2` mode writes
 *   `$savedGroup` references.
 * - After, a guard makes any rule using a remote group match nobody until the
 *   user's remote groups are known.
 */

export type RemoteGroupMode = "attribute" | "referenceV2";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** How a payload in this format, for an SDK with these capabilities, writes remote groups. */
export function getRemoteGroupMode(
  format: SavedGroupFormat,
  capabilities: SDKCapability[] = [],
): RemoteGroupMode {
  return format === "referencesV2" &&
    capabilities.includes(SAVED_GROUP_TYPE_CAPABILITY.remote)
    ? "referenceV2"
    : "attribute";
}

// region Conditions

/**
 * The attribute condition on `__remoteGroupIds` for groups targeted together:
 *
 *   all  -> {"__remoteGroupIds": {"$in": ["a"]}} for one group,
 *           {"__remoteGroupIds": {"$all": ["a", "b"]}} for several
 *   any  -> {"__remoteGroupIds": {"$in": ["a", "b"]}}
 *   none -> {"__remoteGroupIds": {"$nin": ["a", "b"]}}
 */
export function createAttributeConditionFromGroupIds(
  groupIds: string[],
  match: "all" | "any" | "none",
): ConditionInterface {
  if (match === "none") {
    return { [REMOTE_GROUP_IDS_ATTRIBUTE]: { $nin: groupIds } };
  }
  if (match === "all" && groupIds.length > 1) {
    return { [REMOTE_GROUP_IDS_ATTRIBUTE]: { $all: groupIds } };
  }
  return { [REMOTE_GROUP_IDS_ATTRIBUTE]: { $in: groupIds } };
}

/**
 * The V2 reference condition for one group:
 *
 *   in      -> {"$savedGroup": {"id": "a"}}
 *   not in  -> {"$not": {"$savedGroup": {"id": "a"}}}
 */
export function createReferenceV2ConditionFromGroupId(
  groupId: string,
  include: boolean,
): ConditionInterface {
  const reference = { $savedGroup: { id: groupId } };
  return include ? reference : { $not: reference };
}

function createConditionFromGroupId(
  groupId: string,
  include: boolean,
  mode: RemoteGroupMode,
): ConditionInterface {
  return mode === "attribute"
    ? createAttributeConditionFromGroupIds([groupId], include ? "any" : "none")
    : createReferenceV2ConditionFromGroupId(groupId, include);
}

/**
 * Converts `$inGroup` / `$notInGroup` on a remote group. On the group's own
 * attribute it becomes the mode's condition; on another attribute it would
 * need a derived group, which doesn't exist yet, so it fails closed.
 */
export function convertInGroupOperator(
  groupId: string,
  group: Pick<SavedGroupForPayload, "attributeKey">,
  attribute: string,
  include: boolean,
  mode: RemoteGroupMode,
): ConditionInterface {
  if (!group.attributeKey || group.attributeKey !== attribute) {
    return { [SAVED_GROUP_ERROR_INVALID]: groupId };
  }
  return createConditionFromGroupId(groupId, include, mode);
}

// endregion

// region Rewriting data model conditions

/**
 * Rewrites remote groups in a data model condition, in place, so format
 * strategies never see them. With `grp_vip` a remote group on `account_id`:
 *
 *   {"$savedGroups": ["grp_vip", "grp_beta"]}
 *     attribute   -> {"$savedGroups": ["grp_beta"],
 *                     "__remoteGroupIds": {"$in": ["grp_vip"]}}
 *     referenceV2 -> {"$savedGroups": ["grp_beta"],
 *                     "$savedGroup": {"id": "grp_vip"}}
 *
 *   {"account_id": {"$inGroup": "grp_vip"}}
 *     attribute   -> {"__remoteGroupIds": {"$in": ["grp_vip"]}}
 *     referenceV2 -> {"$savedGroup": {"id": "grp_vip"}}
 *
 *   {"account_id": {"$notInGroup": "grp_vip"}}
 *     attribute   -> {"__remoteGroupIds": {"$nin": ["grp_vip"]}}
 *     referenceV2 -> {"$not": {"$savedGroup": {"id": "grp_vip"}}}
 *
 *   {"parent_id": {"$inGroup": "grp_vip"}}   (another attribute)
 *     both        -> {"__sgInvalid__": "grp_vip"}   (matches nobody)
 */
export function rewriteRemoteGroupReferences(
  node: unknown,
  groupMap: GroupMap,
  mode: RemoteGroupMode,
): void {
  if (Array.isArray(node)) {
    node.forEach((child) =>
      rewriteRemoteGroupReferences(child, groupMap, mode),
    );
    return;
  }
  if (!isPlainObject(node)) return;

  // Children first, since rewriting this object rebuilds its keys.
  Object.values(node).forEach((child) =>
    rewriteRemoteGroupReferences(child, groupMap, mode),
  );

  const isRemote = (id: unknown): id is string =>
    typeof id === "string" && groupMap.get(id)?.type === "remote";
  const conditions: ConditionInterface[] = [];

  if ("$savedGroups" in node) {
    const ids = Array.isArray(node.$savedGroups)
      ? node.$savedGroups
      : [node.$savedGroups];
    const remoteIds = ids.filter(isRemote);
    if (remoteIds.length) {
      const rest = ids.filter((id) => !isRemote(id));
      if (rest.length) node.$savedGroups = rest;
      else delete node.$savedGroups;
      // `$savedGroups` means in every listed group
      remoteIds.forEach((id) =>
        conditions.push(createConditionFromGroupId(id, true, mode)),
      );
    }
  }

  for (const [field, value] of Object.entries(node)) {
    if (field.startsWith("$") || !isPlainObject(value)) continue;
    for (const [operator, include] of [
      ["$inGroup", true],
      ["$notInGroup", false],
    ] as const) {
      const groupId = value[operator];
      if (!isRemote(groupId)) continue;
      delete value[operator];
      conditions.push(
        convertInGroupOperator(
          groupId,
          groupMap.get(groupId) ?? {},
          field,
          include,
          mode,
        ),
      );
    }
    if (!Object.keys(value).length) delete node[field];
  }

  if (conditions.length) andConditionsInto(node, conditions);
}

/** A copy of a group with remote groups in its condition rewritten. */
function rewriteRemoteGroupsInGroup<T extends SavedGroupForPayload>(
  group: T,
  groupMap: GroupMap,
  mode: RemoteGroupMode,
): T {
  if (group.type !== "condition" || !group.condition) return group;
  try {
    const condition = JSON.parse(group.condition);
    rewriteRemoteGroupReferences(condition, groupMap, mode);
    return { ...group, condition: JSON.stringify(condition) };
  } catch {
    // Strategies drop unparseable conditions themselves.
    return group;
  }
}

// endregion

// region Guard

/** Whether a condition uses a remote group, directly or through other groups. */
export function usesRemoteGroup(condition: unknown, groupMap: GroupMap) {
  let found = false;
  const groupIds = new Set<string>();
  recursiveWalk(condition, ([key, value]) => {
    if (key === REMOTE_GROUP_IDS_ATTRIBUTE) {
      found = true;
    } else if (key === "$savedGroup") {
      const id = readSavedGroupReferenceId(value);
      if (id) groupIds.add(id);
    } else if (
      key === "$savedGroups" ||
      key === "$inGroup" ||
      key === "$notInGroup"
    ) {
      (Array.isArray(value) ? value : [value]).forEach((v) => {
        if (typeof v === "string") groupIds.add(v);
      });
    }
  });
  if (found) return true;
  for (const id of findAllReferencedSavedGroupIds(groupIds, groupMap)) {
    if (groupMap.get(id)?.type === "remote") return true;
  }
  return false;
}

/**
 * Adds an `$exists` condition on the `__remoteGroupIds` attribute if the
 * condition uses remote groups. This is done because users whose remote
 * groups haven't been looked up yet have no `__remoteGroupIds`, and a "not in
 * group" check would let all of them through; with `$exists` the rule matches
 * nobody until the lookup is done.
 */
export function addRemoteGroupIdsGuard(
  condition: unknown,
  groupMap: GroupMap,
): void {
  if (!isPlainObject(condition) || !usesRemoteGroup(condition, groupMap)) {
    return;
  }
  const existing = condition[REMOTE_GROUP_IDS_ATTRIBUTE];
  if (existing === undefined) {
    condition[REMOTE_GROUP_IDS_ATTRIBUTE] = { $exists: true };
  } else if (
    isPlainObject(existing) &&
    Object.keys(existing).every((k) => k.startsWith("$")) &&
    (existing.$exists ?? true) === true
  ) {
    existing.$exists = true;
  } else {
    andConditionsInto(condition, [
      { [REMOTE_GROUP_IDS_ATTRIBUTE]: { $exists: true } },
    ]);
  }
}

// endregion

/**
 * Calls `fn` with each remote group ID a payload condition checks through
 * `__remoteGroupIds`, so those groups still get `savedGroups` entries:
 *
 *   {"__remoteGroupIds": {"$in": ["grp_1"], "$nin": ["grp_2"]}}
 *     -> "grp_1", "grp_2"
 */
export function forEachRemoteGroupIdInCondition(
  condition: unknown,
  groupMap: GroupMap,
  fn: (id: string) => void,
): void {
  recursiveWalk(condition, ([key, value]) => {
    if (key !== REMOTE_GROUP_IDS_ATTRIBUTE || !isPlainObject(value)) return;
    for (const ids of Object.values(value)) {
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id === "string" && groupMap.get(id)?.type === "remote") {
          fn(id);
        }
      }
    }
  });
}

/**
 * Wraps a format strategy so it handles remote groups. `createStrategy` gets
 * a group map whose condition groups are already rewritten, so the strategy
 * itself never sees a remote group in a condition.
 */
export function withRemoteGroups({
  groupMap,
  mode,
  createStrategy,
}: {
  groupMap: GroupMap;
  mode: RemoteGroupMode;
  createStrategy: (groupMap: GroupMap) => SavedGroupPayloadStrategy;
}): SavedGroupPayloadStrategy {
  // Payloads without remote groups are built exactly as before.
  if (![...groupMap.values()].some((group) => group.type === "remote")) {
    return createStrategy(groupMap);
  }

  const rewrittenGroupMap: GroupMap = new Map(
    [...groupMap].map(([id, group]) => [
      id,
      rewriteRemoteGroupsInGroup(group, groupMap, mode),
    ]),
  );
  const strategy = createStrategy(rewrittenGroupMap);

  return {
    ...strategy,
    // The original map, so callers see each group's real type.
    groupMap,
    createCondition: (args) =>
      groupMap.get(args.groupId)?.type === "remote"
        ? createConditionFromGroupId(args.groupId, args.include, mode)
        : strategy.createCondition(args),
    createSavedGroupsOperatorHandler: () => {
      const handler = strategy.createSavedGroupsOperatorHandler();
      const remoteFirst: NodeHandler = (node, object) => {
        if (node[0] !== "$savedGroups") return handler(node, object);
        rewriteRemoteGroupReferences(object, groupMap, mode);
        if ("$savedGroups" in object) {
          handler(["$savedGroups", object.$savedGroups], object);
        }
      };
      return remoteFirst;
    },
    finalizeCondition: (condition) => {
      rewriteRemoteGroupReferences(condition, groupMap, mode);
      strategy.finalizeCondition(condition);
      addRemoteGroupIdsGuard(condition, groupMap);
    },
    buildSavedGroupsPayload: (usedSavedGroups) =>
      strategy.buildSavedGroupsPayload(
        usedSavedGroups.map((group) =>
          rewriteRemoteGroupsInGroup(group, groupMap, mode),
        ),
      ),
  };
}
