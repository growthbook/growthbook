import { OrganizationInterface } from "shared/types/organization";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import {
  addRemoteGroupIdsGuard,
  createAttributeConditionFromGroupIds,
  getSavedGroupPayloadStrategy,
  SAVED_GROUP_ERROR_INVALID,
  SDKCapability,
} from "../src/sdk-versioning";
import { recursiveWalk } from "../util";

const savedGroup = (
  props: Pick<SavedGroupInterface, "id" | "type"> &
    Partial<SavedGroupInterface>,
): SavedGroupInterface => ({
  organization: "org",
  groupName: props.id,
  owner: "",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  ...props,
});

const groups: SavedGroupInterface[] = [
  savedGroup({ id: "vip", type: "remote", attributeKey: "account_id" }),
  savedGroup({ id: "beta", type: "remote", attributeKey: "user_id" }),
  savedGroup({
    id: "list",
    type: "list",
    attributeKey: "id",
    values: ["1"],
  }),
  savedGroup({
    id: "cond_vip",
    type: "condition",
    condition: JSON.stringify({ $savedGroups: ["vip"] }),
  }),
];
const groupMap: GroupMap = new Map(groups.map((g) => [g.id, g]));
const org = { settings: {} } as OrganizationInterface;

const V1: SDKCapability[] = ["savedGroupReferences"];
const V2: SDKCapability[] = [...V1, "savedGroupReferencesV2"];
const V2_REMOTE: SDKCapability[] = [...V2, "savedGroupReferencesRemote"];

const strategyFor = (
  capabilities: SDKCapability[],
  savedGroupFormat: "inline" | "referencesV1" | "referencesV2",
) =>
  getSavedGroupPayloadStrategy({
    capabilities,
    savedGroupFormat,
    groupMap,
    organization: org,
  });

describe("createAttributeConditionFromGroupIds", () => {
  it("uses $in for any, and for all with one group", () => {
    expect(createAttributeConditionFromGroupIds(["a", "b"], "any")).toEqual({
      __remoteGroupIds: { $in: ["a", "b"] },
    });
    expect(createAttributeConditionFromGroupIds(["a"], "all")).toEqual({
      __remoteGroupIds: { $in: ["a"] },
    });
  });

  it("uses $all for all with several groups", () => {
    expect(createAttributeConditionFromGroupIds(["a", "b"], "all")).toEqual({
      __remoteGroupIds: { $all: ["a", "b"] },
    });
  });

  it("uses $nin for none", () => {
    expect(createAttributeConditionFromGroupIds(["a"], "none")).toEqual({
      __remoteGroupIds: { $nin: ["a"] },
    });
  });
});

describe("addRemoteGroupIdsGuard", () => {
  it("requires the attribute for a negated reference", () => {
    const condition = { $not: { $savedGroup: { id: "vip" } } };
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toEqual({
      $not: { $savedGroup: { id: "vip" } },
      __remoteGroupIds: { $exists: true },
    });
  });

  it("follows condition groups", () => {
    const condition = { $not: { $savedGroup: { id: "cond_vip" } } };
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toHaveProperty("__remoteGroupIds", { $exists: true });
  });

  it("adds to existing operators once", () => {
    const condition = { __remoteGroupIds: { $nin: ["vip"] } };
    addRemoteGroupIdsGuard(condition, groupMap);
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toEqual({
      __remoteGroupIds: { $nin: ["vip"], $exists: true },
    });
  });

  it("leaves conditions without remote groups alone", () => {
    const condition = { $savedGroup: { id: "list" } };
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toEqual({ $savedGroup: { id: "list" } });
  });
});

describe.each([
  ["inline", strategyFor(V1, "inline")],
  ["referencesV1", strategyFor(V1, "referencesV1")],
  ["referencesV2 without the capability", strategyFor(V2, "referencesV2")],
])("remote groups in %s", (_, strategy) => {
  it("rewrites groups", () => {
    expect(strategy.createCondition({ groupId: "vip", include: true })).toEqual(
      { __remoteGroupIds: { $in: ["vip"] } },
    );
    expect(
      strategy.createCondition({ groupId: "vip", include: false }),
    ).toEqual({ __remoteGroupIds: { $nin: ["vip"] } });
  });

  it("rewrites $inGroup and $notInGroup on the group's attribute", () => {
    const condition = {
      country: "US",
      account_id: { $notInGroup: "vip" },
    };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $and: [{ country: "US" }, { __remoteGroupIds: { $nin: ["vip"] } }],
      __remoteGroupIds: { $exists: true },
    });
  });

  it("fails closed on another attribute", () => {
    const condition = { parent_id: { $inGroup: "vip" } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({ [SAVED_GROUP_ERROR_INVALID]: "vip" });
  });

  it("rewrites nested $savedGroups and guards negations", () => {
    const condition = { $not: { $savedGroups: ["vip"] } };
    recursiveWalk(condition, strategy.createSavedGroupsOperatorHandler());
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $not: { __remoteGroupIds: { $in: ["vip"] } },
      __remoteGroupIds: { $exists: true },
    });
  });
});

describe("remote groups in referencesV2 with the capability", () => {
  const strategy = strategyFor(V2_REMOTE, "referencesV2");

  it("keeps references", () => {
    expect(strategy.createCondition({ groupId: "vip", include: true })).toEqual(
      { $savedGroup: { id: "vip" } },
    );
    expect(
      strategy.createCondition({ groupId: "vip", include: false }),
    ).toEqual({ $not: { $savedGroup: { id: "vip" } } });
  });

  it("rewrites $inGroup into a reference", () => {
    const condition = { account_id: { $inGroup: "vip" } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $savedGroup: { id: "vip" },
      __remoteGroupIds: { $exists: true },
    });
  });

  it("emits remote entries", () => {
    expect(strategy.buildSavedGroupsPayload(groups)).toMatchObject({
      vip: { type: "remote", attributeKey: "account_id" },
      cond_vip: {
        type: "condition",
        condition: { $savedGroup: { id: "vip" } },
      },
    });
  });
});

describe("remote groups in a condition group with the capability", () => {
  it("references them, including inside $savedGroups", () => {
    const strategy = strategyFor(V2_REMOTE, "referencesV2");
    const condition = { $not: { $savedGroups: ["vip", "list"] } };
    recursiveWalk(condition, strategy.createSavedGroupsOperatorHandler());
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $not: {
        $and: [{ $savedGroup: { id: "list" } }, { $savedGroup: { id: "vip" } }],
      },
      __remoteGroupIds: { $exists: true },
    });
  });
});

describe("remote entries in referencesV2 without the capability", () => {
  it("emits entries but rewrites condition groups", () => {
    const strategy = strategyFor(V2, "referencesV2");
    expect(strategy.buildSavedGroupsPayload(groups)).toMatchObject({
      vip: { type: "remote", attributeKey: "account_id" },
      cond_vip: {
        type: "condition",
        condition: { __remoteGroupIds: { $in: ["vip"] } },
      },
    });
  });

  it("emits no remote entries for referencesV1", () => {
    const strategy = strategyFor(V1, "referencesV1");
    expect(strategy.buildSavedGroupsPayload(groups)).toEqual({ list: ["1"] });
  });
});
