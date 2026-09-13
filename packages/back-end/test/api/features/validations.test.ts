import type { FeatureInterface } from "shared/types/feature";
import {
  assertValidPrerequisiteParents,
  assertValidRuleEnvironments,
  validateRuleAttributes,
  validateRulesReferences,
} from "back-end/src/api/features/validations";
import { BadRequestError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { getAllFeaturesWithoutEditorFields } from "back-end/src/models/FeatureModel";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getAllFeaturesWithoutEditorFields: jest.fn(),
}));
const scanContext = { scan: true } as unknown as ApiReqContext;
jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: () => scanContext,
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

describe("assertValidPrerequisiteParents", () => {
  const ctx = { org: { id: "org" } } as unknown as ApiReqContext;
  const flag = (id: string, ...parents: string[]): FeatureInterface =>
    ({
      id,
      valueType: "boolean",
      archived: false,
      environmentSettings: { production: { enabled: true } },
      rules: [],
      prerequisites: parents.map((p) => ({ id: p, condition: "{}" })),
    }) as unknown as FeatureInterface;
  // Direct parents load with the caller's context; ancestors with the scan
  // context. Resolves requested ids against whichever map the context gets.
  const stub = (
    visible: (context: unknown) => Record<string, FeatureInterface>,
  ) =>
    jest
      .mocked(getAllFeaturesWithoutEditorFields)
      .mockImplementation(async (context, opts) => {
        const byId = visible(context);
        return (opts?.ids ?? []).flatMap((id) => (byId[id] ? [byId[id]] : []));
      });

  beforeEach(() => jest.mocked(getAllFeaturesWithoutEditorFields).mockReset());

  it("does not query when the write adds no prerequisite", async () => {
    await assertValidPrerequisiteParents(ctx, flag("c", "p"), flag("c", "p"));
    expect(getAllFeaturesWithoutEditorFields).not.toHaveBeenCalled();
  });

  it("finds a cycle through an ancestor the caller cannot read", async () => {
    // c -> p -> hidden -> c; `hidden` only resolves for the scan context.
    const p = flag("p", "hidden");
    const hidden = flag("hidden", "c");
    stub((context) => (context === scanContext ? { p, hidden } : { p }));
    await expect(
      assertValidPrerequisiteParents(ctx, flag("c", "p")),
    ).rejects.toThrow(/circular dependency/);
  });

  it("refuses a chain still open after the depth limit", async () => {
    const byId: Record<string, FeatureInterface> = {};
    for (let i = 0; i < 60; i++) byId[`n${i}`] = flag(`n${i}`, `n${i + 1}`);
    stub(() => byId);
    await expect(
      assertValidPrerequisiteParents(ctx, flag("c", "n0")),
    ).rejects.toThrow(/too deep/);
  });
});
