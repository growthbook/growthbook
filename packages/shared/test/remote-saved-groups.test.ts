import { evalCondition } from "@growthbook/growthbook";
import { OrganizationInterface } from "shared/types/organization";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import {
  addRemoteGroupIdsGuard,
  createAttributeConditionFromGroupIds,
  getSavedGroupPayloadStrategy,
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
      __gb_remoteGroupIds: { $in: ["a", "b"] },
    });
    expect(createAttributeConditionFromGroupIds(["a"], "all")).toEqual({
      __gb_remoteGroupIds: { $in: ["a"] },
    });
  });

  it("uses $all for all with several groups", () => {
    expect(createAttributeConditionFromGroupIds(["a", "b"], "all")).toEqual({
      __gb_remoteGroupIds: { $all: ["a", "b"] },
    });
  });

  it("uses $nin for none", () => {
    expect(createAttributeConditionFromGroupIds(["a"], "none")).toEqual({
      __gb_remoteGroupIds: { $nin: ["a"] },
    });
  });
});

describe("addRemoteGroupIdsGuard", () => {
  it("requires the attribute for a negated reference", () => {
    const condition = { $not: { $savedGroup: { id: "vip" } } };
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toEqual({
      $not: { $savedGroup: { id: "vip" } },
      __gb_remoteGroupIds: { $exists: true },
    });
  });

  it("follows condition groups", () => {
    const condition = { $not: { $savedGroup: { id: "cond_vip" } } };
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toHaveProperty("__gb_remoteGroupIds", { $exists: true });
  });

  it("adds to existing operators once", () => {
    const condition = { __gb_remoteGroupIds: { $nin: ["vip"] } };
    addRemoteGroupIdsGuard(condition, groupMap);
    addRemoteGroupIdsGuard(condition, groupMap);
    expect(condition).toEqual({
      __gb_remoteGroupIds: { $nin: ["vip"], $exists: true },
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
      { __gb_remoteGroupIds: { $in: ["vip"] } },
    );
    expect(
      strategy.createCondition({ groupId: "vip", include: false }),
    ).toEqual({ __gb_remoteGroupIds: { $nin: ["vip"] } });
  });

  it("rewrites $inGroup and $notInGroup on the group's attribute", () => {
    const condition = {
      country: "US",
      account_id: { $notInGroup: "vip" },
    };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $and: [{ country: "US" }, { __gb_remoteGroupIds: { $nin: ["vip"] } }],
      __gb_remoteGroupIds: { $exists: true },
    });
  });

  it("fails closed on another attribute", () => {
    const condition = { parent_id: { $inGroup: "vip" } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({ __sgRemoteOverride__: "vip" });
  });

  it("rewrites nested $savedGroups and guards negations", () => {
    const condition = { $not: { $savedGroups: ["vip"] } };
    recursiveWalk(condition, strategy.createSavedGroupsOperatorHandler());
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $not: { __gb_remoteGroupIds: { $in: ["vip"] } },
      __gb_remoteGroupIds: { $exists: true },
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
      __gb_remoteGroupIds: { $exists: true },
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
      __gb_remoteGroupIds: { $exists: true },
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
        condition: { __gb_remoteGroupIds: { $in: ["vip"] } },
      },
    });
  });

  it("emits no remote entries for referencesV1", () => {
    const strategy = strategyFor(V1, "referencesV1");
    expect(strategy.buildSavedGroupsPayload(groups)).toEqual({ list: ["1"] });
  });
});

describe("remote groups evaluate correctly", () => {
  const evalGroups: SavedGroupInterface[] = [
    ...groups,
    savedGroup({
      id: "cond_override",
      type: "condition",
      condition: JSON.stringify({ parent_id: { $inGroup: "vip" } }),
    }),
  ];
  const evalMap: GroupMap = new Map(evalGroups.map((g) => [g.id, g]));
  const formats = [
    ["inline", V1, "inline"],
    ["referencesV1", V1, "referencesV1"],
    ["referencesV2 without the capability", V2, "referencesV2"],
  ] as const;

  // Builds a rule condition the way a payload build does, then evaluates it.
  const evaluate = (
    capabilities: readonly SDKCapability[],
    savedGroupFormat: "inline" | "referencesV1" | "referencesV2",
    stored: object,
    attributes: Record<string, unknown>,
  ) => {
    const strategy = getSavedGroupPayloadStrategy({
      capabilities: [...capabilities],
      savedGroupFormat,
      groupMap: evalMap,
      organization: org,
    });
    const condition = JSON.parse(JSON.stringify(stored));
    recursiveWalk(condition, strategy.createSavedGroupsOperatorHandler());
    strategy.finalizeCondition(condition);
    const payloadGroups = strategy.buildSavedGroupsPayload(evalGroups);
    return evalCondition(
      attributes,
      condition,
      payloadGroups as Parameters<typeof evalCondition>[2],
    );
  };
  const member = {
    account_id: "a1",
    parent_id: "p1",
    __gb_remoteGroupIds: ["vip"],
  };
  const nonMember = {
    account_id: "a2",
    parent_id: "p2",
    __gb_remoteGroupIds: [],
  };
  const unresolved = { account_id: "a3", parent_id: "p3" };

  describe.each(formats)("in %s", (_, capabilities, format) => {
    const check = (stored: object, expected: [boolean, boolean, boolean]) =>
      expect(
        [member, nonMember, unresolved].map((a) =>
          evaluate(capabilities, format, stored, a),
        ),
      ).toEqual(expected);

    it("in group", () => {
      check({ account_id: { $inGroup: "vip" } }, [true, false, false]);
    });

    it("not in group", () => {
      check({ account_id: { $notInGroup: "vip" } }, [false, true, false]);
    });

    it("attribute-level $not around $inGroup", () => {
      check({ account_id: { $not: { $inGroup: "vip" } } }, [
        false,
        true,
        false,
      ]);
    });

    it("another attribute fails closed, even negated", () => {
      check({ parent_id: { $inGroup: "vip" } }, [false, false, false]);
      check({ $not: { parent_id: { $inGroup: "vip" } } }, [
        false,
        false,
        false,
      ]);
    });

    it("a condition group with an override fails closed, even negated", () => {
      check({ $not: { $savedGroups: ["cond_override"] } }, [
        false,
        false,
        false,
      ]);
    });

    it("$savedGroups through a condition group", () => {
      check({ $savedGroups: ["cond_vip"] }, [true, false, false]);
      check({ $not: { $savedGroups: ["cond_vip"] } }, [false, true, false]);
    });

    it("keeps unrelated empty-object conditions", () => {
      const stored = { profile: {}, account_id: { $inGroup: "vip" } };
      expect(
        evaluate(capabilities, format, stored, {
          ...member,
          profile: { role: "admin" },
        }),
      ).toBe(false);
      expect(
        evaluate(capabilities, format, stored, { ...member, profile: {} }),
      ).toBe(true);
    });
  });

  it("referencesV2 with the capability keeps references and fails closed on overrides", () => {
    const strategy = strategyFor(V2_REMOTE, "referencesV2");
    const negated = { account_id: { $not: { $inGroup: "vip" } } };
    strategy.finalizeCondition(negated);
    expect(negated).toEqual({
      $not: { $savedGroup: { id: "vip" } },
      __gb_remoteGroupIds: { $exists: true },
    });
    const override = { $not: { parent_id: { $inGroup: "vip" } } };
    strategy.finalizeCondition(override);
    expect(override).toEqual({ __sgRemoteOverride__: "vip" });
  });
});
