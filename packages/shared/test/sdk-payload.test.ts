import { OrganizationInterface } from "shared/types/organization";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import {
  conditionHasSavedGroupErrors,
  createV1SavedGroupsOperatorHandler,
  getPayloadAllowedKeys,
  buildV2SavedGroupsPayload,
  findAllReferencedSavedGroupIds,
  resolveSavedGroupRendering,
  getSavedGroupPayloadStrategy,
  SAVED_GROUP_ERROR_CYCLE,
  SAVED_GROUP_ERROR_INVALID,
  SAVED_GROUP_ERROR_MAX_DEPTH,
  SAVED_GROUP_ERROR_UNKNOWN,
} from "../src/sdk-versioning";
import { recursiveWalk } from "../util";

describe("createV1SavedGroupsOperatorHandler", () => {
  it("allows valid nested saved groups", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({ country: "US" }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            browser: "chrome",
            $savedGroups: ["sg_1"],
          }),
        },
      }),
    );

    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(savedGroups));

    expect(condition).toEqual({
      $and: [{ os: "ios" }, { browser: "chrome" }, { country: "US" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });

  it("handles cycles in saved groups", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: JSON.stringify({
          $savedGroups: ["sg_2"],
        }),
      },
      sg_2: {
        id: "sg_2",
        type: "condition",
        condition: JSON.stringify({
          $savedGroups: ["sg_1"],
        }),
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      os: "ios",
      $savedGroups: ["sg_1"],
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(groupMap));
    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_CYCLE]: "sg_1" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles unknown saved groups", () => {
    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(new Map()));
    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_UNKNOWN]: "sg_2" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles conflicts in merged conditions", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: JSON.stringify({
          country: { $nin: ["US"] },
          bar: "baz",
        }),
      },
      sg_2: {
        id: "sg_2",
        type: "condition",
        condition: JSON.stringify({
          country: { $ne: "CA" },
          foo: "bar",
          $savedGroups: ["sg_1"],
        }),
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      $savedGroups: ["sg_2"],
      country: "GB",
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(groupMap));
    expect(condition).toEqual({
      $and: [
        { country: "GB" },
        { country: { $ne: "CA" }, foo: "bar" },
        {
          country: { $nin: ["US"] },
          bar: "baz",
        },
      ],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });

  it("handles max depth", () => {
    const savedGroups = {} as Record<string, SavedGroupInterface>;
    for (let i = 1; i <= 15; i++) {
      const nextId = i === 15 ? "" : `sg_${i + 1}`;
      savedGroups[`sg_${i}`] = {
        id: `sg_${i}`,
        type: "condition",
        condition: JSON.stringify({
          [`level${i}`]: true,
          $savedGroups: [nextId],
        }),
      } as SavedGroupInterface;
    }
    const condition = {
      $savedGroups: ["sg_1"],
    };
    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(groupMap));
    expect(condition).toEqual({
      $and: [
        { level1: true },
        { level2: true },
        { level3: true },
        { level4: true },
        { level5: true },
        { level6: true },
        { level7: true },
        { level8: true },
        { level9: true },
        { level10: true },
        { [SAVED_GROUP_ERROR_MAX_DEPTH]: true },
      ],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles nested saved group with invalid JSON", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: "{ invalidJson: true ",
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      os: "ios",
      $savedGroups: ["sg_1"],
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(groupMap));

    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_INVALID]: "sg_1" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("expands nested ID list saved groups into attribute conditions", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_idlist1: {
          id: "sg_idlist1",
          type: "list",
          attributeKey: "id",
          values: ["00001", "00002"],
        },
      }),
    );

    const condition = {
      os: "ios",
      $savedGroups: ["sg_idlist1"],
    };

    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(savedGroups));

    expect(condition).toEqual({
      $and: [{ os: "ios" }, { id: { $inGroup: "sg_idlist1" } }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });

  it("flattens empty $ands", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            $savedGroups: ["sg_1"],
          }),
        },
        sg_3: {
          id: "sg_3",
          type: "condition",
          condition: JSON.stringify({
            $savedGroups: ["sg_2"],
          }),
        },
      }),
    );

    const condition = {
      $savedGroups: ["sg_3"],
    };

    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(savedGroups));

    expect(condition).toEqual({
      foo: "bar",
    });
  });
  it("merges into existing $and", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            bar: "baz",
            $savedGroups: ["sg_1"],
          }),
        },
      }),
    );

    const condition = {
      $and: [{ country: "US" }, { platform: "ios" }],
      $savedGroups: ["sg_2"],
    };
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(savedGroups));
    expect(condition).toEqual({
      $and: [
        { country: "US" },
        { platform: "ios" },
        { bar: "baz" },
        { foo: "bar" },
      ],
    });
    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });
  it("works with existing broken $and (non-array)", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
      }),
    );

    const condition = {
      $and: { country: "US" },
      $savedGroups: ["sg_1"],
    };
    recursiveWalk(condition, createV1SavedGroupsOperatorHandler(savedGroups));
    expect(condition).toEqual({
      $and: [{ $and: { country: "US" } }, { foo: "bar" }],
    });
    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });
});

describe("getPayloadAllowedKeys (contextual bandits)", () => {
  it("preserves contextual-bandit rule keys (contextualBanditRef + contextualVariations) when the capability is present", () => {
    const { featureRuleKeys } = getPayloadAllowedKeys(["contextualBandits"]);
    expect(featureRuleKeys).toContain("contextualBanditRef");
    expect(featureRuleKeys).toContain("contextualVariations");
    expect(featureRuleKeys).not.toContain("contexts");
    expect(featureRuleKeys).not.toContain("banditVersion");
  });

  it("scrubs contextual-bandit rule keys when the capability is absent", () => {
    const { featureRuleKeys } = getPayloadAllowedKeys(["bucketingV2"]);
    expect(featureRuleKeys).not.toContain("contextualBanditRef");
    expect(featureRuleKeys).not.toContain("contextualVariations");
    expect(featureRuleKeys).toContain("weights");
  });
});

describe("createV2SavedGroupsOperatorHandler", () => {
  const groupMap: GroupMap = new Map([
    ["list_1", { type: "list", attributeKey: "country", values: ["US"] }],
    ["list_noattr", { type: "list", attributeKey: "", values: ["US"] }],
    [
      "cond_1",
      { type: "condition", condition: JSON.stringify({ browser: "chrome" }) },
    ],
    [
      "cond_2",
      {
        type: "condition",
        condition: JSON.stringify({ $savedGroups: ["list_1"] }),
      },
    ],
    ["cond_empty", { type: "condition", condition: "{}" }],
    ["cond_bad", { type: "condition", condition: "{not json" }],
  ]);

  const rewrite = (condition: Record<string, unknown>) => {
    const strategy = getSavedGroupPayloadStrategy({
      capabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
      savedGroupReferencesEnabled: true,
      groupMap,
    });
    recursiveWalk(condition, strategy.createSavedGroupsOperatorHandler());
    return condition;
  };

  it("turns a one-id array into a single $savedGroup", () => {
    expect(rewrite({ $savedGroups: ["cond_1"] })).toEqual({
      $savedGroup: "cond_1",
    });
  });

  it("turns a multi-id array into an $and of $savedGroup", () => {
    expect(rewrite({ $savedGroups: ["cond_1", "list_1"] })).toEqual({
      $and: [{ $savedGroup: "cond_1" }, { $savedGroup: "list_1" }],
    });
  });

  it("accepts a hand-written scalar", () => {
    expect(rewrite({ $savedGroups: "cond_1" })).toEqual({
      $savedGroup: "cond_1",
    });
  });

  it("drops an empty array", () => {
    expect(rewrite({ $savedGroups: [] })).toEqual({});
  });

  it("references list groups instead of using $inGroup", () => {
    expect(rewrite({ $savedGroups: ["list_1"] })).toEqual({
      $savedGroup: "list_1",
    });
  });

  it("preserves negation as NOT(A AND B), not per-group", () => {
    expect(rewrite({ $not: { $savedGroups: ["cond_1", "list_1"] } })).toEqual({
      $not: { $and: [{ $savedGroup: "cond_1" }, { $savedGroup: "list_1" }] },
    });
  });

  it("merges sibling keys into $and", () => {
    expect(rewrite({ country: "US", $savedGroups: ["cond_1"] })).toEqual({
      $and: [{ country: "US" }, { $savedGroup: "cond_1" }],
    });
  });

  it("skips an empty condition group, so it still always passes", () => {
    expect(rewrite({ $savedGroups: ["cond_empty"] })).toEqual({});
  });

  it("still flags unknown groups", () => {
    const result = rewrite({ $savedGroups: ["nope"] });
    expect(conditionHasSavedGroupErrors(result)).toBe(true);
    expect(result).toEqual({ [SAVED_GROUP_ERROR_UNKNOWN]: "nope" });
  });

  it("still flags a list group with no attributeKey", () => {
    expect(rewrite({ $savedGroups: ["list_noattr"] })).toEqual({
      [SAVED_GROUP_ERROR_INVALID]: "list_noattr",
    });
  });

  it("still flags an unparseable condition group", () => {
    expect(rewrite({ $savedGroups: ["cond_bad"] })).toEqual({
      [SAVED_GROUP_ERROR_INVALID]: "cond_bad",
    });
  });

  it("does not go deeper, so nested references stay for the SDK", () => {
    // cond_2 references list_1. That stays inside cond_2's own entry.
    expect(rewrite({ $savedGroups: ["cond_2"] })).toEqual({
      $savedGroup: "cond_2",
    });
  });

  it("matches the v1 handler when the strategy is v1", () => {
    const fixtures: Record<string, unknown>[] = [
      { $savedGroups: ["cond_1"] },
      { $savedGroups: ["cond_1", "list_1"] },
      { $not: { $savedGroups: ["cond_1", "list_1"] } },
      { country: "US", $savedGroups: ["cond_2"] },
      { $savedGroups: ["cond_empty"] },
      { $savedGroups: ["nope"] },
    ];
    const v1 = getSavedGroupPayloadStrategy({ groupMap });
    fixtures.forEach((fixture) => {
      const viaDefault = JSON.parse(JSON.stringify(fixture));
      const viaStrategy = JSON.parse(JSON.stringify(fixture));
      recursiveWalk(viaDefault, createV1SavedGroupsOperatorHandler(groupMap));
      recursiveWalk(viaStrategy, v1.createSavedGroupsOperatorHandler());
      expect(viaStrategy).toEqual(viaDefault);
      // v1 must never emit $savedGroup
      expect(JSON.stringify(viaDefault)).not.toContain('$savedGroup"');
    });
  });
});

describe("findAllReferencedSavedGroupIds", () => {
  const groupMap: GroupMap = new Map([
    ["list_1", { type: "list", attributeKey: "country", values: ["US"] }],
    [
      "a",
      { type: "condition", condition: JSON.stringify({ $savedGroups: ["b"] }) },
    ],
    [
      "b",
      {
        type: "condition",
        condition: JSON.stringify({ $savedGroup: "list_1" }),
      },
    ],
    [
      "cycle_1",
      {
        type: "condition",
        condition: JSON.stringify({ $savedGroups: ["cycle_2"] }),
      },
    ],
    [
      "cycle_2",
      {
        type: "condition",
        condition: JSON.stringify({ $savedGroups: ["cycle_1"] }),
      },
    ],
    [
      "selfref",
      {
        type: "condition",
        condition: JSON.stringify({ $savedGroups: ["selfref"] }),
      },
    ],
  ]);

  it("returns the seed when nothing is nested", () => {
    expect(findAllReferencedSavedGroupIds(["list_1"], groupMap)).toEqual(
      new Set(["list_1"]),
    );
  });

  it("follows a multi-hop chain through both operator spellings", () => {
    expect(findAllReferencedSavedGroupIds(["a"], groupMap)).toEqual(
      new Set(["a", "b", "list_1"]),
    );
  });

  it("terminates on a mutual cycle", () => {
    expect(findAllReferencedSavedGroupIds(["cycle_1"], groupMap)).toEqual(
      new Set(["cycle_1", "cycle_2"]),
    );
  });

  it("terminates on a self-reference", () => {
    expect(findAllReferencedSavedGroupIds(["selfref"], groupMap)).toEqual(
      new Set(["selfref"]),
    );
  });

  it("ignores ids that are not in the map", () => {
    expect(findAllReferencedSavedGroupIds(["nope"], groupMap)).toEqual(
      new Set(["nope"]),
    );
  });
});

describe("buildV2SavedGroupsPayload", () => {
  const org: Pick<OrganizationInterface, "settings"> = { settings: {} };
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
    savedGroup({
      id: "list_1",
      type: "list",
      attributeKey: "country",
      values: ["US", "GB"],
    }),
    savedGroup({
      id: "list_noattr",
      type: "list",
      attributeKey: "",
      values: ["US"],
    }),
    savedGroup({
      id: "cond_1",
      type: "condition",
      condition: JSON.stringify({ browser: "chrome" }),
    }),
    savedGroup({
      id: "cond_nested",
      type: "condition",
      condition: JSON.stringify({ $savedGroups: ["cond_1", "list_1"] }),
    }),
    savedGroup({ id: "cond_bad", type: "condition", condition: "{not json" }),
  ];
  const groupMap: GroupMap = new Map(groups.map((g) => [g.id, g]));

  it("builds typed entries for both group types", () => {
    const defs = buildV2SavedGroupsPayload(groups, org, groupMap);
    expect(defs["list_1"]).toEqual({
      type: "list",
      attributeKey: "country",
      values: ["US", "GB"],
    });
    expect(defs["cond_1"]).toEqual({
      type: "condition",
      condition: { browser: "chrome" },
    });
  });

  it("rewrites a nested $savedGroups into $savedGroup", () => {
    const defs = buildV2SavedGroupsPayload(groups, org, groupMap);
    expect(defs["cond_nested"]).toEqual({
      type: "condition",
      condition: {
        $and: [{ $savedGroup: "cond_1" }, { $savedGroup: "list_1" }],
      },
    });
    // $savedGroups must never reach the payload
    expect(JSON.stringify(defs)).not.toContain("$savedGroups");
  });

  it("omits a list group with no attributeKey", () => {
    const defs = buildV2SavedGroupsPayload(groups, org, groupMap);
    expect(defs["list_noattr"]).toBeUndefined();
  });

  it("omits an unparseable condition group rather than throwing", () => {
    const defs = buildV2SavedGroupsPayload(groups, org, groupMap);
    expect(defs["cond_bad"]).toBeUndefined();
  });
});

describe("resolveSavedGroupRendering", () => {
  it("keeps reference operators when there is no SDK connection", () => {
    // Previews and the in-app evaluators pass no capabilities. They pass the
    // group values in separately when they evaluate.
    expect(resolveSavedGroupRendering({ capabilities: undefined })).toBe(
      "referencesV1",
    );
    expect(
      resolveSavedGroupRendering({
        capabilities: undefined,
        savedGroupReferencesEnabled: false,
        canInline: true,
      }),
    ).toBe("referencesV1");
  });

  it("inlines when the connection opted out", () => {
    expect(
      resolveSavedGroupRendering({
        capabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
        savedGroupReferencesEnabled: false,
        canInline: true,
      }),
    ).toBe("inline");
  });

  it("treats an absent opt-in as disabled", () => {
    expect(
      resolveSavedGroupRendering({
        capabilities: ["savedGroupReferences"],
        canInline: true,
      }),
    ).toBe("inline");
  });

  it("inlines when the SDK cannot resolve references at all", () => {
    expect(
      resolveSavedGroupRendering({
        capabilities: ["looseUnmarshalling"],
        savedGroupReferencesEnabled: true,
        canInline: true,
      }),
    ).toBe("inline");
  });

  it("falls back to v1 references when it cannot inline", () => {
    // With no organization there is nothing to inline from, so the operators
    // are left for a later pass.
    expect(
      resolveSavedGroupRendering({
        capabilities: ["looseUnmarshalling"],
        savedGroupReferencesEnabled: true,
        canInline: false,
      }),
    ).toBe("referencesV1");
  });

  it("uses v1 references for an SDK that lacks the v2 capability", () => {
    expect(
      resolveSavedGroupRendering({
        capabilities: ["savedGroupReferences"],
        savedGroupReferencesEnabled: true,
        canInline: true,
      }),
    ).toBe("referencesV1");
  });

  it("uses v2 references only with both capabilities and the opt-in", () => {
    expect(
      resolveSavedGroupRendering({
        capabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
        savedGroupReferencesEnabled: true,
        canInline: true,
      }),
    ).toBe("referencesV2");
  });

  it("does not use v2 references without the v1 capability", () => {
    // Cannot happen today, since v2 is newer than v1. Asking for both is what
    // stops the conditions and the savedGroups map disagreeing.
    expect(
      resolveSavedGroupRendering({
        capabilities: ["savedGroupReferencesV2"],
        savedGroupReferencesEnabled: true,
        canInline: true,
      }),
    ).toBe("inline");
  });
});

describe("createInlineStrategy", () => {
  const org = {
    settings: {
      attributeSchema: [
        { property: "country", datatype: "string" },
        { property: "age", datatype: "number" },
      ],
    },
  } as OrganizationInterface;

  const groupMap: GroupMap = new Map([
    ["list_1", { type: "list", attributeKey: "country", values: ["US", "CA"] }],
    ["list_num", { type: "list", attributeKey: "age", values: ["21", "30"] }],
    [
      "cond_1",
      { type: "condition", condition: JSON.stringify({ browser: "chrome" }) },
    ],
  ]);

  const strategy = () =>
    getSavedGroupPayloadStrategy({
      capabilities: ["looseUnmarshalling"],
      groupMap,
      organization: org,
    });

  it("is the strategy chosen when the SDK cannot resolve references", () => {
    expect(strategy().rendering).toBe("inline");
  });

  it("swaps $inGroup for $in with the group's values", () => {
    const condition = { country: { $inGroup: "list_1" } };
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({ country: { $in: ["US", "CA"] } });
  });

  it("swaps $notInGroup for $nin", () => {
    const condition = { country: { $notInGroup: "list_1" } };
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({ country: { $nin: ["US", "CA"] } });
  });

  it("coerces values to the attribute's datatype", () => {
    const condition = { age: { $inGroup: "list_num" } };
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({ age: { $in: [21, 30] } });
  });

  it("inlines an unknown group to an empty list, so it matches nobody", () => {
    const condition = { country: { $inGroup: "gone" } };
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({ country: { $in: [] } });
  });

  it("inlines a group nested inside $and and $or", () => {
    const condition = {
      $or: [{ country: { $inGroup: "list_1" } }, { $not: { age: 5 } }],
    };
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({
      $or: [{ country: { $in: ["US", "CA"] } }, { $not: { age: 5 } }],
    });
  });

  it("builds no savedGroups field, since the values are already in place", () => {
    expect(strategy().buildSavedGroupsPayload([])).toBeUndefined();
  });

  it("expands a condition group in place, then inlines what it produced", () => {
    const condition = { $savedGroups: ["cond_1", "list_1"] };
    recursiveWalk(condition, strategy().createSavedGroupsOperatorHandler());
    strategy().finalizeCondition(condition);
    expect(condition).toEqual({
      $and: [{ browser: "chrome" }, { country: { $in: ["US", "CA"] } }],
    });
  });
});

describe("getSavedGroupPayloadStrategy", () => {
  const org = { settings: {} } as OrganizationInterface;
  const groupMap: GroupMap = new Map([
    ["list_1", { type: "list", attributeKey: "country", values: ["US"] }],
  ]);

  it("exposes the group map it was built from", () => {
    expect(getSavedGroupPayloadStrategy({ groupMap }).groupMap).toBe(groupMap);
  });

  it("cannot inline without an organization, so it keeps references", () => {
    // No organization means no attribute types to coerce values with
    const strategy = getSavedGroupPayloadStrategy({
      capabilities: ["looseUnmarshalling"],
      groupMap,
    });
    expect(strategy.rendering).toBe("referencesV1");
    const condition = { country: { $inGroup: "list_1" } };
    strategy.finalizeCondition(condition);
    expect(condition).toEqual({ country: { $inGroup: "list_1" } });
  });

  it("builds conditions in the format it reports", () => {
    const cases = [
      {
        strategy: getSavedGroupPayloadStrategy({
          capabilities: ["looseUnmarshalling"],
          groupMap,
          organization: org,
        }),
        rendering: "inline",
        expected: { country: { $inGroup: "list_1" } },
      },
      {
        strategy: getSavedGroupPayloadStrategy({
          capabilities: ["savedGroupReferences"],
          savedGroupReferencesEnabled: true,
          groupMap,
          organization: org,
        }),
        rendering: "referencesV1",
        expected: { country: { $inGroup: "list_1" } },
      },
      {
        strategy: getSavedGroupPayloadStrategy({
          capabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
          savedGroupReferencesEnabled: true,
          groupMap,
          organization: org,
        }),
        rendering: "referencesV2",
        expected: { $savedGroup: "list_1" },
      },
    ];
    cases.forEach(({ strategy, rendering, expected }) => {
      expect(strategy.rendering).toBe(rendering);
      expect(
        strategy.createCondition({ groupId: "list_1", include: true }),
      ).toEqual(expected);
    });
  });

  it("returns null for a group that is not in the map", () => {
    expect(
      getSavedGroupPayloadStrategy({ groupMap }).createCondition({
        groupId: "gone",
        include: true,
      }),
    ).toBeNull();
  });
});
