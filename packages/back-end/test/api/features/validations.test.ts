import { validateRuleAttributes } from "back-end/src/api/features/validations";
import { BadRequestError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";

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
