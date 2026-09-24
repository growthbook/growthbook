import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  assertValidFeatureRules,
  assertValidRuleEnvironments,
  assertValidRuleWrite,
  collectRampPlanPatches,
  normalizeInlineRampSchedule,
  rampPatchEntries,
  rampPatchEntriesForTargets,
  validateChangedPhaseReferences,
  validateRampPlanPatches,
  validateRuleAttributes,
  validateRulesReferences,
  stagedFeatureOf,
} from "back-end/src/api/features/validations";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";
import { BadRequestError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
}));

// `validateRuleAttributes` is the V2-side gate for the opt-in
// `requireRegisteredAttributes` org setting. Most of the underlying
// behavior is covered by `assertRegisteredAttributes` in
// test/services/attributes.test.ts; this file locks down the contract
// the V2 handlers (postFeatureV2, updateFeatureV2,
// postFeatureRevisionRuleAddV2, putFeatureRevisionRuleV2) actually call:
//   1. typo'd hashAttribute → BadRequestError
//   2. opt-out (setting off) → no-op even with bad input
//   3. fields the patch didn't touch are not validated (caller-side
//      gating in putFeatureRevisionRuleV2 — verified by passing only
//      the changed field)
const makeContext = (
  overrides: Partial<{
    requireRegisteredAttributes:
      | boolean
      | { isOn: boolean; requireProjectScoping: boolean };
    attributeSchema: Array<{
      property: string;
      datatype: "string";
      archived?: boolean;
    }>;
  }> = {},
): ApiReqContext => {
  return {
    org: {
      settings: {
        requireRegisteredAttributes:
          overrides.requireRegisteredAttributes ?? true,
        attributeSchema: overrides.attributeSchema ?? [
          { property: "userId", datatype: "string" },
          { property: "country", datatype: "string" },
        ],
      },
    },
  } as unknown as ApiReqContext;
};

describe("validateRuleAttributes (V2 helper)", () => {
  it("rejects a rule with a typo'd hashAttribute when the setting is on", () => {
    const ctx = makeContext();
    expect(() =>
      validateRuleAttributes({ hashAttribute: "userID", condition: "{}" }, ctx),
    ).toThrow(BadRequestError);
    expect(() =>
      validateRuleAttributes({ hashAttribute: "userID", condition: "{}" }, ctx),
    ).toThrow(/userID/);
  });

  it("is a no-op when the org setting is off, even with bogus attributes", () => {
    const ctx = makeContext({ requireRegisteredAttributes: false });
    expect(() =>
      validateRuleAttributes(
        {
          hashAttribute: "totally_made_up",
          fallbackAttribute: "also_fake",
          condition: JSON.stringify({ another_typo: "x" }),
        },
        ctx,
      ),
    ).not.toThrow();
  });

  it("only validates fields present on the input — unchanged fields aren't re-checked", () => {
    // putFeatureRevisionRuleV2 only invokes validateRuleAttributes when
    // the PATCH body touches hashAttribute, fallbackAttribute, or
    // condition. Simulate the "only condition changed" case: passing
    // a fresh registered condition is fine even if the rule's existing
    // hashAttribute (not in the input here) would have been invalid.
    const ctx = makeContext();
    expect(() =>
      validateRuleAttributes(
        { condition: JSON.stringify({ country: { $eq: "US" } }) },
        ctx,
      ),
    ).not.toThrow();
  });

  it("scopes attribute lookup to the rule's project when provided", () => {
    const ctx = makeContext({
      attributeSchema: [
        // userId is org-wide (no projects[]); must be valid in every project.
        {
          property: "userId",
          datatype: "string",
        } as unknown as Parameters<
          typeof makeContext
        >[0]["attributeSchema"][number],
      ],
    });
    expect(() =>
      validateRuleAttributes({ hashAttribute: "userId" }, ctx, "any-project"),
    ).not.toThrow();
  });

  it("rejects an attribute that exists but is scoped to a different project, with a project-aware message", () => {
    const ctx = makeContext({
      attributeSchema: [
        // `country` is registered, but only for proj_one. Calling it from
        // proj_two should fail with the "not part of this project's scope"
        // message rather than the generic "Unknown attribute key" message.
        {
          property: "country",
          datatype: "string",
          // Cast through unknown — fixture type forbids `projects` but the
          // shared util reads it.
          projects: ["proj_one"],
        } as unknown as Parameters<
          typeof makeContext
        >[0]["attributeSchema"][number],
      ],
    });
    let err: unknown;
    try {
      validateRuleAttributes({ hashAttribute: "country" }, ctx, "proj_two");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as Error).message).toMatch(/not part of this project's scope/);
    expect((err as Error).message).toMatch(/country/);
    // Critical: this is *not* an "Unknown attribute key(s)" error.
    expect((err as Error).message).not.toMatch(/Unknown attribute key/);
  });

  it("with requireProjectScoping=false, accepts attributes scoped to other projects but still rejects typos", () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
      attributeSchema: [
        { property: "userId", datatype: "string" },
        // `country` is scoped to proj_one; with requireProjectScoping off,
        // calling it from proj_two should pass.
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as Parameters<
          typeof makeContext
        >[0]["attributeSchema"][number],
      ],
    });
    expect(() =>
      validateRuleAttributes({ hashAttribute: "country" }, ctx, "proj_two"),
    ).not.toThrow();
    // Typos still fail — relaxing project-scope is not the same as turning
    // the registered-attributes check off.
    expect(() =>
      validateRuleAttributes({ hashAttribute: "userID" }, ctx, "proj_two"),
    ).toThrow(BadRequestError);
  });
});

// Reject/accept outcomes are pinned end-to-end in ruleReferenceIntegrity.test.ts;
// this covers what that harness cannot observe.
describe("validateRulesReferences", () => {
  const getAll = jest.fn();
  const ctx = {
    org: { settings: { attributeSchema: [] } },
    models: { savedGroups: { getAll } },
  } as unknown as ApiReqContext;

  beforeEach(() => {
    getAll.mockReset();
    getAll.mockResolvedValue([
      { id: "grp_known", type: "list", attributeKey: "id", values: ["1"] },
    ]);
  });

  it("accepts rules whose conditions parse and whose groups exist, loading saved groups once", async () => {
    await expect(
      validateRulesReferences(
        [
          { condition: '{"country": "US"}' },
          { savedGroups: [{ match: "all", ids: ["grp_known"] }] },
          { condition: '{"id": {"$inGroup": "grp_known"}}' },
          {},
        ],
        ctx,
      ),
    ).resolves.toBeUndefined();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("does not load saved groups for an empty rules list", async () => {
    await validateRulesReferences([], ctx);
    expect(getAll).not.toHaveBeenCalled();
  });
});

// v2 rule / feature write paths: a rule's `environments` list may only name
// environments the organization has (v1 checks its single `environment` the
// same way).
describe("assertValidRuleEnvironments", () => {
  const ctx = {
    org: {
      settings: {
        environments: [{ id: "production" }, { id: "qa" }],
      },
    },
  } as unknown as ApiReqContext;

  it("accepts rules that list known environments or none", () => {
    expect(() =>
      assertValidRuleEnvironments(ctx, [
        { environments: ["production", "qa"] },
        { environments: [] },
        {},
      ]),
    ).not.toThrow();
  });

  it("rejects a rule that lists an environment the organization does not have", () => {
    expect(() =>
      assertValidRuleEnvironments(ctx, [
        { environments: ["production"] },
        { environments: ["prodution"] },
      ]),
    ).toThrow(BadRequestError);
    expect(() =>
      assertValidRuleEnvironments(ctx, [{ environments: ["prodution"] }]),
    ).toThrow('Invalid environment: "prodution"');
  });

  it("ignores the list on a rule scoped to all environments", () => {
    expect(() =>
      assertValidRuleEnvironments(ctx, [
        { allEnvironments: true, environments: ["prodution"] },
      ]),
    ).not.toThrow();
    expect(() =>
      assertValidRuleEnvironments(ctx, [
        { allEnvironments: false, environments: ["prodution"] },
      ]),
    ).toThrow(BadRequestError);
  });
});

// Ramp schedule patches carry the same targeting fields as a rule and are
// written onto the live rule when a step fires, so a plan is checked with the
// rule endpoints' helpers when it is written.
describe("rampPatchEntriesForTargets", () => {
  it("pairs each action with its target's flag and rule, by the patch's ruleId or the target's", () => {
    const rule = { id: "r1", type: "force", environments: ["production"] };
    const feature = { id: "f1", rules: [rule] } as unknown as FeatureInterface;
    const targets = [
      { id: "t1", entityId: "f1", ruleId: "r1" },
      { id: "t2", entityId: "gone", ruleId: "r9" },
    ];
    const entries = rampPatchEntriesForTargets(
      [
        { targetId: "t1", patch: { coverage: 0.5 } },
        { targetId: "t2", patch: { condition: "{}" } },
        { targetId: "t1", patch: null },
      ],
      targets,
      (id) => (id === "f1" ? feature : null),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].feature).toBe(feature);
    expect(entries[0].rule).toMatchObject({ id: "r1" });
    expect(entries[1]).toMatchObject({ feature: null, rule: null });
  });
});

describe("rule write composites", () => {
  const ctx = {
    org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
    models: { savedGroups: { getAll: jest.fn().mockResolvedValue([]) } },
    getAllProjectIds: async () => [],
    hasPremiumFeature: () => true,
    canSkipSchemaValidationFor: () => false,
  } as unknown as ApiReqContext;
  const rule = (environments: string[], extra: Partial<FeatureRule> = {}) =>
    ({
      id: "fr_1",
      type: "force",
      value: "true",
      allEnvironments: false,
      environments,
      ...extra,
    }) as FeatureRule;
  const feature = { valueType: "boolean" } as FeatureInterface;

  it("checks environment ids only where the scope differs from the stored rule", async () => {
    await expect(
      assertValidFeatureRules(ctx, [rule(["gone"])], [rule(["gone"])]),
    ).resolves.toBeUndefined();
    await expect(
      assertValidFeatureRules(ctx, [rule(["gone"])], [rule(["production"])]),
    ).rejects.toThrow(/Invalid environment: "gone"/);
    await expect(
      assertValidFeatureRules(ctx, [rule(["gone"])]),
    ).rejects.toThrow(/Invalid environment: "gone"/);
  });

  it("checks a schedule's shape only when it differs from the stored rule", async () => {
    const malformed = {
      scheduleRules: [{ enabled: true }],
    } as Partial<FeatureRule>;
    await expect(
      assertValidFeatureRules(
        ctx,
        [rule(["production"], malformed)],
        [rule(["production"], malformed)],
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertValidFeatureRules(ctx, [rule(["production"], malformed)]),
    ).rejects.toThrow(/scheduleRules/);
  });

  it("checks a rule's values only when the write changes them", async () => {
    const maybe = rule(["production"], { value: "maybe" });
    await expect(
      assertValidRuleWrite(ctx, feature, maybe, maybe),
    ).resolves.toBeUndefined();
    await expect(
      assertValidRuleWrite(ctx, feature, maybe, rule(["production"])),
    ).rejects.toThrow(/Must be "true" or "false"/);
    await expect(assertValidRuleWrite(ctx, feature, maybe)).rejects.toThrow(
      /Must be "true" or "false"/,
    );
  });
});

describe("validateChangedPhaseReferences", () => {
  const getAll = jest.fn();
  const ctx = {
    org: { id: "org_1", settings: { attributeSchema: [] } },
    models: { savedGroups: { getAll } },
  } as unknown as ApiReqContext;
  const stale = {
    condition: '{"id": {"$inGroup": "grp_gone"}}',
    savedGroups: [{ match: "all" as const, ids: ["grp_gone"] }],
  };

  beforeEach(() => {
    getAll.mockReset();
    getAll.mockResolvedValue([
      { id: "grp_known", type: "list", attributeKey: "id", values: ["1"] },
    ]);
  });

  it("checks conditions and saved groups a stored phase does not already hold", async () => {
    await expect(
      validateChangedPhaseReferences([{ condition: '{"country": ' }], [], ctx),
    ).rejects.toThrow(BadRequestError);
    await expect(
      validateChangedPhaseReferences(
        [{ savedGroups: [{ match: "any", ids: ["grp_missing"] }] }],
        [],
        ctx,
      ),
    ).rejects.toThrow(/grp_missing/);
    // Untargeted and echoed phases load nothing.
    await expect(
      validateChangedPhaseReferences(
        [{ condition: "", savedGroups: [] }, stale, { condition: "{}" }],
        [stale],
        ctx,
      ),
    ).resolves.toBeUndefined();
    expect(getAll).toHaveBeenCalledTimes(2);
    // History is exempt for what any stored phase holds; the served (last)
    // phase only for what the served stored phase holds.
    const served = { condition: '{"country": "US"}' };
    await expect(
      validateChangedPhaseReferences([stale, served], [stale, served], ctx),
    ).resolves.toBeUndefined();
    await expect(
      validateChangedPhaseReferences([served, stale], [stale, served], ctx),
    ).rejects.toThrow(/grp_gone/);
    await expect(
      validateChangedPhaseReferences(
        [{ ...stale, savedGroups: [{ match: "all", ids: ["grp_known"] }] }],
        [stale],
        ctx,
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateChangedPhaseReferences(
        [{ ...stale, condition: '{"id": {"$inGroup": "grp_missing"}}' }],
        [stale],
        ctx,
      ),
    ).rejects.toThrow(/grp_missing/);
  });
});

describe("collectRampPlanPatches", () => {
  it("gathers step, start, end, startState and endPatch patches and skips malformed entries", () => {
    expect(
      collectRampPlanPatches({
        steps: [
          { actions: [{ patch: { coverage: 0.1 } }, { patch: null }] },
          { actions: null },
          {},
        ],
        startActions: [{ patch: { condition: "{}" } }],
        endActions: [{ patch: { enabled: false } }, {}],
        startState: { coverage: 0 },
        endPatch: { environments: ["qa"] },
      }),
    ).toEqual([
      { condition: "{}" },
      { coverage: 0.1 },
      { enabled: false },
      { coverage: 0 },
      { environments: ["qa"] },
    ]);
    expect(collectRampPlanPatches(undefined)).toEqual([]);
    expect(collectRampPlanPatches({})).toEqual([]);
  });
});

describe("stagedFeatureOf", () => {
  it("keeps the live rules when the draft has no rules snapshot", () => {
    const live = {
      id: "f1",
      rules: [{ id: "r_live" }],
    } as unknown as FeatureInterface;
    expect(
      stagedFeatureOf(live, { metadata: { project: "p_draft" } }),
    ).toMatchObject({ project: "p_draft", rules: [{ id: "r_live" }] });
  });
});

describe("validateRampPlanPatches", () => {
  const getAll = jest.fn();
  const ctx = {
    org: {
      id: "org_1",
      settings: {
        attributeSchema: [],
        environments: [{ id: "production" }, { id: "qa" }],
      },
    },
    models: { savedGroups: { getAll } },
  } as unknown as ApiReqContext;
  (ctx as { scanContextOverride?: ApiReqContext }).scanContextOverride = ctx;
  const envSettings = {
    production: { enabled: true, rules: [] },
    qa: { enabled: true, rules: [] },
  };
  const feature = {
    id: "checkout_flag",
    organization: "org_1",
    valueType: "boolean",
    defaultValue: "false",
    environmentSettings: envSettings,
    rules: [],
    prerequisites: [],
  } as unknown as FeatureInterface;
  const parent = (extra: Partial<FeatureInterface> = {}) =>
    ({
      id: "parent_flag",
      organization: "org_1",
      valueType: "boolean",
      archived: false,
      environmentSettings: envSettings,
      rules: [],
      prerequisites: [],
      ...extra,
    }) as FeatureInterface;
  const loadFeatures = getAllFeaturesWithoutEditorFields as jest.Mock;
  const run = (
    patches: Parameters<typeof rampPatchEntries>[0],
    target: FeatureInterface | null = feature,
    rule?: Parameters<typeof rampPatchEntries>[2],
    stored?: unknown[],
  ) =>
    validateRampPlanPatches(ctx, rampPatchEntries(patches, target, rule), {
      stored,
    });
  const prereqOnParent = {
    prerequisites: [{ id: "parent_flag", condition: '{"value": true}' }],
  };

  beforeEach(() => {
    getAll.mockReset();
    getAll.mockResolvedValue([
      { id: "grp_known", type: "list", attributeKey: "id", values: ["1"] },
    ]);
    loadFeatures.mockReset();
    loadFeatures.mockResolvedValue([parent()]);
  });

  it("does no lookups for patches without targeting fields", async () => {
    await expect(
      run([
        {},
        { allEnvironments: true },
        { condition: null, savedGroups: null },
      ]),
    ).resolves.toBeUndefined();
    expect(getAll).not.toHaveBeenCalled();
    expect(loadFeatures).not.toHaveBeenCalled();
  });

  it("accepts a plan whose conditions parse and whose references exist", async () => {
    await expect(
      run([
        { condition: '{"country": "US"}' },
        { savedGroups: [{ match: "all", ids: ["grp_known"] }] },
        { environments: ["qa"] },
        prereqOnParent,
      ]),
    ).resolves.toBeUndefined();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  // Bad conditions, missing groups and unknown environments are asserted end
  // to end in rampPatchReferences.test.ts.
  it.each([
    [
      "$inGroup naming an unknown group",
      { condition: '{"id": {"$inGroup": "grp_missing"}}' },
      /^Invalid ramp schedule patch: .*grp_missing/,
    ],
    [
      "a prerequisite whose condition does not parse",
      { prerequisites: [{ id: "parent_flag", condition: "{" }] },
      /prerequisite/i,
    ],
    [
      "a null environments list",
      { environments: null },
      /environments cannot be null/,
    ],
    [
      "a null environments list beside an explicit non-wildcard",
      { allEnvironments: false, environments: null },
      /environments cannot be null/,
    ],
  ])("rejects %s", async (_label, patch, message) => {
    const result = run([patch]);
    await expect(result).rejects.toThrow(BadRequestError);
    await expect(result).rejects.toThrow(message);
  });

  it("accepts the anchor spelling of a rule with no list on a first write", async () => {
    await expect(
      run([{ allEnvironments: true, environments: null }]),
    ).resolves.toBeUndefined();
  });

  it("ignores the environments list on a patch scoped to all environments", async () => {
    await expect(
      run([{ allEnvironments: true, environments: ["prodution"] }]),
    ).resolves.toBeUndefined();
  });

  it("rejects a prerequisite on a missing or archived feature", async () => {
    loadFeatures.mockResolvedValue([]);
    await expect(run([prereqOnParent])).rejects.toThrow(
      /Prerequisite feature "parent_flag" not found/,
    );
    loadFeatures.mockResolvedValue([parent({ archived: true })]);
    await expect(run([prereqOnParent])).rejects.toThrow(
      /Prerequisite feature "parent_flag" is archived/,
    );
  });

  it("rejects a prerequisite that would make the flag depend on itself", async () => {
    await expect(
      run([{ prerequisites: [{ id: "checkout_flag", condition: "{}" }] }]),
    ).rejects.toThrow(/cannot be its own prerequisite/);
  });

  // The parent already gates on this flag in production only. Cycles are per
  // environment, so the reverse edge closes a cycle only where both meet.
  describe("with a parent that depends on the flag in production", () => {
    const productionOnlyParent = () =>
      parent({
        rules: [
          {
            type: "force",
            id: "fr_parent",
            description: "",
            value: "true",
            enabled: true,
            allEnvironments: false,
            environments: ["production"],
            prerequisites: [{ id: "checkout_flag", condition: "{}" }],
          },
        ],
      });
    beforeEach(() => {
      loadFeatures.mockImplementation(async (_ctx, { ids }) =>
        [productionOnlyParent(), feature].filter((f) => ids.includes(f.id)),
      );
    });

    it("accepts the prerequisite on a rule scoped to another environment", async () => {
      await expect(
        run([prereqOnParent], feature, {
          allEnvironments: false,
          environments: ["qa"],
        }),
      ).resolves.toBeUndefined();
      // The patch's own scope wins over the target rule's.
      await expect(
        run([{ ...prereqOnParent, environments: ["qa"] }], feature, {
          allEnvironments: true,
        }),
      ).resolves.toBeUndefined();
      // `allEnvironments: false` alone keeps the rule's list.
      await expect(
        run([{ ...prereqOnParent, allEnvironments: false }], feature, {
          allEnvironments: false,
          environments: ["qa"],
        }),
      ).resolves.toBeUndefined();
    });

    it("rejects it where the rule and the parent's gate share an environment", async () => {
      await expect(
        run([prereqOnParent], feature, {
          allEnvironments: false,
          environments: ["production"],
        }),
      ).rejects.toThrow(/circular dependency/);
      await expect(
        run([{ ...prereqOnParent, environments: ["production"] }], feature, {
          allEnvironments: false,
          environments: ["qa"],
        }),
      ).rejects.toThrow(/circular dependency/);
      // Rule scope unknown: judged in every environment.
      await expect(run([prereqOnParent], feature, null)).rejects.toThrow(
        /circular dependency/,
      );
      // `allEnvironments: false` with no environments list applies everywhere
      // (ruleAppliesToEnv), on the target rule and on the patch alike.
      await expect(
        run([prereqOnParent], feature, { allEnvironments: false }),
      ).rejects.toThrow(/circular dependency/);
    });
  });

  it("re-walks the cycle when only the scope changes and the rule already carries the gate", async () => {
    loadFeatures.mockImplementation(async (_ctx, { ids }) =>
      [
        parent({
          rules: [
            {
              type: "force",
              id: "fr_parent",
              description: "",
              value: "true",
              enabled: true,
              allEnvironments: false,
              environments: ["production"],
              prerequisites: [{ id: "checkout_flag", condition: "{}" }],
            },
          ],
        }),
        feature,
      ].filter((f) => ids.includes(f.id)),
    );
    // Stored: the gate lives in qa. The edit moves the rule to production
    // without touching the prerequisites, which the walk must still see.
    const gatedRule = {
      id: "fr_gated",
      allEnvironments: false,
      environments: ["qa"],
      ...prereqOnParent,
    };
    const target = {
      ...feature,
      rules: [{ ...gatedRule, type: "force", value: "true", enabled: true }],
    } as unknown as FeatureInterface;
    const stored = [
      {
        steps: [
          { actions: [{ patch: { ...prereqOnParent, environments: ["qa"] } }] },
        ],
      },
    ];
    await expect(
      run(
        [{ ...prereqOnParent, environments: ["production"] }],
        target,
        gatedRule,
        stored,
      ),
    ).rejects.toThrow(/circular dependency/);
    // Widening to every environment is a scope change too.
    await expect(
      run(
        [{ ...prereqOnParent, allEnvironments: true }],
        target,
        gatedRule,
        stored,
      ),
    ).rejects.toThrow(/circular dependency/);
    // Clearing the gate in the same step leaves nothing to walk.
    await expect(
      run(
        [{ prerequisites: null, environments: ["production"] }],
        target,
        gatedRule,
        stored,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses to ramp a force rule's coverage unless the rule or the plan's start state names a hash attribute", async () => {
    const forceRule = { id: "fr_force", type: "force" };
    const refused = run([{ coverage: 0.5 }], feature, forceRule);
    await expect(refused).rejects.toThrow(BadRequestError);
    await expect(refused).rejects.toThrow(
      /Invalid ramp schedule patch: Rule "fr_force" on "checkout_flag" is a force rule with no hash attribute/,
    );
    // A rule not yet stored has no id; the refusal still names the problem.
    await expect(
      run([{ coverage: 0.5 }], feature, { type: "force" }),
    ).rejects.toThrow(/The rule is a force rule with no hash attribute/);
    // The start anchor's hash attribute or one left on the rule satisfies it;
    // a rollout never needed one.
    await expect(
      run([{ coverage: 0.5 }, { hashAttribute: "id" }], feature, forceRule),
    ).resolves.toBeUndefined();
    await expect(
      run([{ coverage: 0.5 }], feature, { ...forceRule, hashAttribute: "id" }),
    ).resolves.toBeUndefined();
    await expect(
      run([{ coverage: 0.5 }], feature, {
        ...forceRule,
        type: "rollout",
        hashAttribute: "id",
      }),
    ).resolves.toBeUndefined();
  });

  it("holds an anchor's hash attribute to the organization's registered attributes", async () => {
    const forceRule = { id: "fr_force", type: "force" };
    const strict = {
      ...ctx,
      org: {
        ...ctx.org,
        settings: {
          requireRegisteredAttributes: true,
          attributeSchema: [{ property: "userId", datatype: "string" }],
        },
      },
    } as ApiReqContext;
    const runStrict = (patches: Parameters<typeof rampPatchEntries>[0]) =>
      validateRampPlanPatches(
        strict,
        rampPatchEntries(patches, feature, forceRule),
      );
    await expect(
      runStrict([{ coverage: 0.5, hashAttribute: "userID" }]),
    ).rejects.toThrow(/userID/);
    await expect(
      runStrict([{ coverage: 0.5, hashAttribute: "userId" }]),
    ).resolves.toBeUndefined();
  });

  it("checks only existence for a plan with no target feature", async () => {
    await expect(run([prereqOnParent], null)).resolves.toBeUndefined();
    loadFeatures.mockResolvedValue([]);
    await expect(run([prereqOnParent], null)).rejects.toThrow(
      /Prerequisite feature "parent_flag" not found/,
    );
  });

  it("re-checks only the fields that differ from the stored patch for that rule", async () => {
    const stale = {
      ruleId: "fr_1",
      condition: '{"country": "US"}',
      savedGroups: [{ match: "all" as const, ids: ["grp_gone"] }],
    };
    const stored = [{ steps: [{ actions: [{ patch: stale }] }] }];
    // A pure echo, and an edit of another field, leave the stale group alone;
    // so does the same patch without a ruleId, or with an env-suffixed one.
    await expect(run([stale], feature, null, stored)).resolves.toBeUndefined();
    await expect(
      run([{ ...stale, ruleId: undefined }], feature, null, stored),
    ).resolves.toBeUndefined();
    await expect(
      run([{ ...stale, ruleId: "fr_1__production" }], feature, null, stored),
    ).resolves.toBeUndefined();
    expect(getAll).not.toHaveBeenCalled();
    await expect(
      run(
        [{ ...stale, condition: '{"country": "DE"}' }],
        feature,
        null,
        stored,
      ),
    ).resolves.toBeUndefined();
    // Touching the field itself re-checks it, as does the same patch aimed at
    // another rule.
    await expect(
      run(
        [
          {
            ...stale,
            savedGroups: [{ match: "all", ids: ["grp_gone", "grp_known"] }],
          },
        ],
        feature,
        null,
        stored,
      ),
    ).rejects.toThrow(/grp_gone/);
    await expect(
      run([{ ...stale, ruleId: "fr_2" }], feature, null, stored),
    ).rejects.toThrow(/grp_gone/);
  });
});

describe("Saved Group scope in ramp patches", () => {
  const groups = [
    {
      id: "scoped",
      type: "list",
      projects: ["a"],
      attributeKey: "id",
      values: ["1"],
    },
    {
      id: "nested",
      type: "condition",
      projects: [],
      condition: '{"id":{"$inGroup":"scoped"}}',
    },
  ];
  const getAllWithoutValues = jest.fn().mockResolvedValue(groups);
  const context = {
    org: { settings: { enforceSavedGroupProjectScope: true } },
    models: {
      savedGroups: {
        getAll: jest.fn().mockResolvedValue(groups),
        getAllWithoutValues,
      },
    },
  } as unknown as ApiReqContext;
  (context as { scanContextOverride?: ApiReqContext }).scanContextOverride =
    context;
  const rule: FeatureRule = {
    id: "rule",
    type: "force",
    value: "true",
    allEnvironments: true,
  };
  const feature = {
    id: "flag",
    project: "b",
    rules: [rule],
  } as FeatureInterface;
  const condition = '{"id":{"$inGroup":"scoped"}}';
  const validate = (
    patch: Parameters<typeof rampPatchEntries>[0][number],
    target = feature,
    stored: unknown[] = [],
  ) =>
    validateRampPlanPatches(
      context,
      rampPatchEntries([patch], target, target.rules[0]),
      { stored },
    );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    { condition },
    { savedGroups: [{ match: "all" as const, ids: ["scoped"] }] },
    { condition: '{"$savedGroups":["nested"]}' },
  ])(
    "rejects new out-of-scope targeting at plan write time (%j)",
    async (patch) => {
      await expect(validate(patch)).rejects.toThrow(
        /Invalid ramp schedule patch: .*not available/,
      );
    },
  );

  it.each(["startActions", "steps", "endActions"])(
    "checks references supplied in %s",
    async (part) => {
      const actions = [{ patch: { ruleId: rule.id, condition } }];
      const plan =
        part === "steps" ? { steps: [{ actions }] } : { [part]: actions };
      await expect(
        validateRampPlanPatches(
          context,
          rampPatchEntries(collectRampPlanPatches(plan), feature, rule),
        ),
      ).rejects.toThrow("not available");
    },
  );

  it("keeps loose mode unchanged", async () => {
    await expect(
      validateRampPlanPatches(
        { ...context, org: { ...context.org, settings: {} } },
        rampPatchEntries([{ condition }], feature, rule),
      ),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("checks targetingProjects and the target rule's Project scope", async () => {
    const multi = { ...feature, project: "a", targetingProjects: ["b"] };
    await expect(validate({ condition }, multi)).rejects.toThrow(
      "not available",
    );
    await expect(
      validate(
        { condition },
        {
          ...multi,
          rules: [{ ...rule, allProjects: false, projects: ["a"] }],
        },
      ),
    ).resolves.toBeUndefined();
    await expect(
      validate({ condition }, { ...feature, project: "" }),
    ).rejects.toThrow("not available");
  });

  it("preserves a live legacy reference when a ramp anchor replays it", async () => {
    const legacy = { ...feature, rules: [{ ...rule, condition }] };
    await expect(validate({ condition }, legacy)).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });

  it("preserves stored plan references through unrelated targeting edits", async () => {
    const stored = [
      { steps: [{ actions: [{ patch: { ruleId: rule.id, condition } }] }] },
    ];
    await expect(
      validate(
        { condition: '{"id":{"$inGroup":"scoped"},"country":"US"}' },
        feature,
        stored,
      ),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
    await expect(
      validate(
        { condition, ruleId: "other" },
        { ...feature, rules: [{ ...rule, id: "other" }] },
        stored,
      ),
    ).rejects.toThrow("not available");
  });

  it("uses the patched condition when clearing an existing reference", async () => {
    await expect(
      validate(
        { condition: "{}" },
        { ...feature, rules: [{ ...rule, condition }] },
      ),
    ).resolves.toBeUndefined();
    expect(getAllWithoutValues).not.toHaveBeenCalled();
  });
});

describe("normalizeInlineRampSchedule", () => {
  it("omits startActions and endActions when the input does not provide them", () => {
    const action = normalizeInlineRampSchedule({ steps: [] }, "r1");
    expect("startActions" in action).toBe(false);
    expect("endActions" in action).toBe(false);
    expect(action).toMatchObject({ mode: "create", ruleId: "r1", steps: [] });
  });

  it("normalizes provided startActions and endActions into feature-rule actions", () => {
    const action = normalizeInlineRampSchedule(
      {
        steps: [],
        startActions: [{ patch: { coverage: 0 } }],
        endActions: [{ targetId: "t1", patch: { coverage: 1 } }],
      },
      "r1",
    );
    expect(action.startActions).toEqual([
      { targetType: "feature-rule", targetId: "", patch: { coverage: 0 } },
    ]);
    expect(action.endActions).toEqual([
      { targetType: "feature-rule", targetId: "t1", patch: { coverage: 1 } },
    ]);
  });
});
