import { evalCondition, EvalConditionOptions } from "@growthbook/growthbook";
import { OrganizationInterface } from "shared/types/organization";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import {
  addRemoteGroupIdsGuard,
  createAttributeConditionFromGroupIds,
  getDerivedRemoteGroups,
  getSavedGroupPayloadStrategy,
  parseDerivedGroupId,
  SDKCapability,
} from "../src/sdk-versioning";
import { recursiveWalk, targetingReferencesSavedGroup } from "../util";

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

  it("uses the derived group on another attribute", () => {
    const condition = { parent_id: { $inGroup: "vip" } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      __gb_remoteGroupIds: { $in: ["vip:parent_id"], $exists: true },
    });
  });

  it("rewrites a hand-written $savedGroup reference", () => {
    const condition = { $not: { $savedGroup: { id: "vip" } } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $not: { __gb_remoteGroupIds: { $in: ["vip"] } },
      __gb_remoteGroupIds: { $exists: true },
    });
  });

  it("uses the derived group for a hand-written $savedGroup on another attribute", () => {
    const condition = {
      $savedGroup: { id: "vip", attributeKey: "parent_id" },
    };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      __gb_remoteGroupIds: { $in: ["vip:parent_id"], $exists: true },
    });
  });

  it("rewrites a hand-written $savedGroup reference to a derived group", () => {
    const condition = { $not: { $savedGroup: { id: "vip:parent_id" } } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({
      $not: { __gb_remoteGroupIds: { $in: ["vip:parent_id"] } },
      __gb_remoteGroupIds: { $exists: true },
    });
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

describe("derived group IDs", () => {
  it("split at the first ':' when the source is a remote group", () => {
    expect(parseDerivedGroupId("vip:parent_id", groupMap)).toEqual({
      sourceId: "vip",
      attribute: "parent_id",
    });
    expect(parseDerivedGroupId("vip:a:b.c", groupMap)).toEqual({
      sourceId: "vip",
      attribute: "a:b.c",
    });
    expect(parseDerivedGroupId("list:id", groupMap)).toBeNull();
    expect(parseDerivedGroupId("missing:id", groupMap)).toBeNull();
    expect(parseDerivedGroupId("vip", groupMap)).toBeNull();
    expect(parseDerivedGroupId("vip:", groupMap)).toBeNull();
  });
});

describe("targetingReferencesSavedGroup", () => {
  it("counts a derived ID as a reference to its source group", () => {
    const derived = JSON.stringify({ $savedGroup: { id: "vip:parent_id" } });
    expect(targetingReferencesSavedGroup({ condition: derived }, "vip")).toBe(
      true,
    );
    expect(
      targetingReferencesSavedGroup(
        { prerequisites: [{ condition: derived }] },
        "vip",
      ),
    ).toBe(true);
    // Only a whole ID before the ":" matches
    expect(targetingReferencesSavedGroup({ condition: derived }, "vi")).toBe(
      false,
    );
    expect(
      targetingReferencesSavedGroup(
        { condition: JSON.stringify({ id: { $inGroup: "vip_2" } }) },
        "vip",
      ),
    ).toBe(false);
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

  // Builds a rule condition the way a payload build does.
  const build = (
    capabilities: readonly SDKCapability[],
    savedGroupFormat: "inline" | "referencesV1" | "referencesV2",
    stored: object,
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
    return { condition, payloadGroups };
  };
  const evaluate = (
    capabilities: readonly SDKCapability[],
    savedGroupFormat: "inline" | "referencesV1" | "referencesV2",
    stored: object,
    attributes: Record<string, unknown>,
  ) => {
    const { condition, payloadGroups } = build(
      capabilities,
      savedGroupFormat,
      stored,
    );
    return evalCondition(attributes, condition, {
      savedGroups: payloadGroups as EvalConditionOptions["savedGroups"],
    });
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
  // A member through the derived group `vip:parent_id`
  const derivedMember = {
    account_id: "a4",
    parent_id: "p4",
    __gb_remoteGroupIds: ["vip:parent_id"],
  };

  describe.each(formats)("in %s", (_, capabilities, format) => {
    const check = (
      stored: object,
      expected: boolean[],
      users = [member, nonMember, unresolved],
    ) =>
      expect(
        users.map((a) => evaluate(capabilities, format, stored, a)),
      ).toEqual(expected);
    const derivedUsers = [derivedMember, member, nonMember, unresolved];

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

    it("another attribute uses the derived group, also negated", () => {
      check(
        { parent_id: { $inGroup: "vip" } },
        [true, false, false, false],
        derivedUsers,
      );
      check(
        { $not: { parent_id: { $inGroup: "vip" } } },
        [false, true, true, false],
        derivedUsers,
      );
    });

    it("a condition group with an override uses the derived group", () => {
      check(
        { $savedGroups: ["cond_override"] },
        [true, false, false, false],
        derivedUsers,
      );
      check(
        { $not: { $savedGroups: ["cond_override"] } },
        [false, true, true, false],
        derivedUsers,
      );
    });

    it("$savedGroups through a condition group", () => {
      check({ $savedGroups: ["cond_vip"] }, [true, false, false]);
      check({ $not: { $savedGroups: ["cond_vip"] } }, [false, true, false]);
    });

    it("keeps unrelated empty-object conditions", () => {
      const stored = { profile: {}, account_id: { $inGroup: "vip" } };
      expect(
        JSON.stringify(build(capabilities, format, stored).condition),
      ).toContain('"profile":{}');
      expect(evaluate(capabilities, format, stored, member)).toBe(true);
      expect(evaluate(capabilities, format, stored, nonMember)).toBe(false);
    });
  });

  it("referencesV2 with the capability references groups and derived groups", () => {
    const strategy = strategyFor(V2_REMOTE, "referencesV2");
    const negated = { account_id: { $not: { $inGroup: "vip" } } };
    strategy.finalizeCondition(negated);
    expect(negated).toEqual({
      $not: { $savedGroup: { id: "vip" } },
      __gb_remoteGroupIds: { $exists: true },
    });
    const override = { $not: { parent_id: { $inGroup: "vip" } } };
    strategy.finalizeCondition(override);
    expect(override).toEqual({
      $not: { $savedGroup: { id: "vip:parent_id" } },
      __gb_remoteGroupIds: { $exists: true },
    });
    const handWritten = {
      $savedGroup: { id: "vip", attributeKey: "parent_id" },
    };
    strategy.finalizeCondition(handWritten);
    expect(handWritten).toEqual({
      $savedGroup: { id: "vip:parent_id" },
      __gb_remoteGroupIds: { $exists: true },
    });
  });

  it("emits derived entries for derived groups, including ones in condition groups", () => {
    const strategy = getSavedGroupPayloadStrategy({
      capabilities: V2_REMOTE,
      savedGroupFormat: "referencesV2",
      groupMap: evalMap,
      organization: org,
    });
    const payload = strategy.buildSavedGroupsPayload([
      ...evalGroups,
      ...getDerivedRemoteGroups(["beta:email"], evalGroups),
    ]);
    expect(payload).toMatchObject({
      vip: { type: "remote", attributeKey: "account_id" },
      "vip:parent_id": {
        type: "remote",
        attributeKey: "parent_id",
        valuesFrom: "vip",
      },
      "beta:email": {
        type: "remote",
        attributeKey: "email",
        valuesFrom: "beta",
      },
      cond_override: {
        type: "condition",
        condition: { $savedGroup: { id: "vip:parent_id" } },
      },
    });
  });
});
