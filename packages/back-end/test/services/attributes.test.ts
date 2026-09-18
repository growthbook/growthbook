import {
  assertRegisteredAttributes,
  assertRegisteredAttributesScoped,
  lazyAttributeScope,
} from "back-end/src/services/attributes";
import { BadRequestError } from "back-end/src/util/errors";
import { ReqContext } from "back-end/types/request";

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
): ReqContext => {
  return {
    org: {
      settings: {
        requireRegisteredAttributes:
          overrides.requireRegisteredAttributes ?? true,
        attributeSchema: overrides.attributeSchema ?? [
          { property: "userId", datatype: "string" },
          { property: "country", datatype: "string" },
          { property: "legacyId", datatype: "string", archived: true },
        ],
      },
    },
  } as unknown as ReqContext;
};

describe("assertRegisteredAttributes", () => {
  it("is a no-op when the setting is off", () => {
    const ctx = makeContext({ requireRegisteredAttributes: false });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "typo_attribute",
          condition: JSON.stringify({ another_typo: "x" }),
        },
        "rule",
      ),
    ).not.toThrow();
  });

  it("passes when all keys are registered", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "userId",
          condition: JSON.stringify({
            country: { $eq: "US" },
            $or: [{ userId: "a" }, { userId: "b" }],
          }),
        },
        "rule",
      ),
    ).not.toThrow();
  });

  it("throws for an unknown hashAttribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "accountUUID" }, "rule"),
    ).toThrow(BadRequestError);
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "accountUUID" }, "rule"),
    ).toThrow(/accountUUID/);
  });

  it("throws for an unknown fallbackAttribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", fallbackAttribute: "device_UUID" },
        "experiment",
      ),
    ).toThrow(/device_UUID/);
  });

  it("throws for an unknown condition attribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { condition: JSON.stringify({ account_uuid: "x" }) },
        "rule",
      ),
    ).toThrow(/account_uuid/);
  });

  it("treats archived attributes as unknown", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "legacyId" }, "rule"),
    ).toThrow(/legacyId/);
  });

  it("aggregates every bad key into a single error", () => {
    const ctx = makeContext();
    let err: Error | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "typo1",
          fallbackAttribute: "typo2",
          condition: JSON.stringify({ typo3: "x", typo4: "y" }),
        },
        "rule",
      );
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/typo1/);
    expect(err?.message).toMatch(/typo2/);
    expect(err?.message).toMatch(/typo3/);
    expect(err?.message).toMatch(/typo4/);
  });

  it("silently ignores unparseable condition JSON (validateCondition reports that)", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "{bad json" },
        "rule",
      ),
    ).not.toThrow();
  });

  it("ignores empty condition / whitespace / {} ", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "{}" },
        "rule",
      ),
    ).not.toThrow();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "" },
        "rule",
      ),
    ).not.toThrow();
  });

  it("accepts dot-notation keys whose root is registered", () => {
    const ctx = makeContext({
      attributeSchema: [{ property: "user", datatype: "string" }],
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { condition: JSON.stringify({ "user.id": "x", "user.role": "y" }) },
        "rule",
      ),
    ).not.toThrow();
  });

  it("emits a project-scope-aware error when the attribute exists but isn't on this project", () => {
    // `country` is registered, but only for proj_one. Calling it from
    // proj_two should fail with a "not part of this project's scope"
    // message rather than the generic "Unknown attribute key" message —
    // the user otherwise reads the latter as "must declare" and tries to
    // recreate it.
    const ctx = makeContext({
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          // Cast — fixture type forbids `projects`, but the shared util reads it.
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/not part of this project's scope/);
    expect(err?.message).toMatch(/country/);
    expect(err?.message).not.toMatch(/Unknown attribute key/);
  });

  it("splits unknown vs out-of-project attributes in the same error", () => {
    const ctx = makeContext({
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "country",
          fallbackAttribute: "totally_made_up",
        },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    // Both buckets are surfaced.
    expect(err?.message).toMatch(/Unknown attribute key/);
    expect(err?.message).toMatch(/totally_made_up/);
    expect(err?.message).toMatch(/not part of this project's scope/);
    expect(err?.message).toMatch(/country/);
  });

  // Feature and experiment callers pass a targeting-union of projects rather
  // than a single id. The attribute is in scope when ANY project overlaps.
  it("accepts a project-scoped attribute when any project in the union matches", () => {
    const ctx = makeContext({
      attributeSchema: [
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        ["proj_two", "proj_one"],
      ),
    ).not.toThrow();
  });

  it("rejects a project-scoped attribute when no project in the union matches", () => {
    const ctx = makeContext({
      attributeSchema: [
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        ["proj_two", "proj_three"],
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/not part of this project's scope/);
  });

  // The setting is stored as an object on new orgs; legacy boolean shapes
  // still come through unchanged on older orgs. Lock down both forms behave
  // the same for the strict (everything-on) case so we don't regress
  // either path during future edits.
  it("treats legacy boolean and { isOn:true, requireProjectScoping:true } identically", () => {
    const schema = [
      { property: "userId", datatype: "string" as const },
      {
        property: "country",
        datatype: "string" as const,
        projects: ["proj_one"],
      } as unknown as {
        property: string;
        datatype: "string";
        archived?: boolean;
      },
    ];
    const legacy = makeContext({
      requireRegisteredAttributes: true,
      attributeSchema: schema,
    });
    const obj = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
      attributeSchema: schema,
    });
    for (const ctx of [legacy, obj]) {
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          { hashAttribute: "country" },
          "rule",
          undefined,
          "proj_two",
        ),
      ).toThrow(BadRequestError);
    }
  });

  it("with requireProjectScoping=false, accepts an attribute scoped to other projects", () => {
    // The user has opted into "must be a registered attribute" but NOT into
    // "must also be in this project's scope". An attribute that exists
    // anywhere in the org should pass even when the rule's project doesn't
    // appear on the attribute's scope list.
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        "proj_two",
      ),
    ).not.toThrow();
  });

  it("with requireProjectScoping=false, still rejects truly-unknown / typo'd attributes", () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userID" },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/Unknown attribute key/);
    expect(err?.message).toMatch(/userID/);
    expect(err?.message).not.toMatch(/not part of this project's scope/);
  });

  // The experiment targeting endpoint always re-posts the full payload, so a
  // traffic-only or targeting-only save still sends every field. Passing the
  // persisted values as `existingParts` means stale (already-saved) attributes
  // don't block unrelated edits — only newly changed attributes are validated.
  describe("change-aware validation via existingParts", () => {
    it("allows an unchanged stale invalid hashAttribute", () => {
      const ctx = makeContext();
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          { hashAttribute: "stale_typo", condition: "{}" },
          "experiment",
          { hashAttribute: "stale_typo", condition: "{}" },
        ),
      ).not.toThrow();
    });

    it("still rejects a newly changed invalid hashAttribute", () => {
      const ctx = makeContext();
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          { hashAttribute: "new_typo", condition: "{}" },
          "experiment",
          { hashAttribute: "userId", condition: "{}" },
        ),
      ).toThrow(/new_typo/);
    });

    it("allows an unchanged stale invalid condition attribute", () => {
      const ctx = makeContext();
      const staleCondition = JSON.stringify({ stale_attr: "x" });
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          { hashAttribute: "userId", condition: staleCondition },
          "experiment",
          { hashAttribute: "userId", condition: staleCondition },
        ),
      ).not.toThrow();
    });

    it("still rejects a newly changed invalid condition attribute", () => {
      const ctx = makeContext();
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          {
            hashAttribute: "userId",
            condition: JSON.stringify({ new_attr: "x" }),
          },
          "experiment",
          {
            hashAttribute: "userId",
            condition: JSON.stringify({ country: "US" }),
          },
        ),
      ).toThrow(/new_attr/);
    });
  });

  it("with isOn=false and a bogus attribute, is a no-op (master switch beats sub-toggles)", () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: false, requireProjectScoping: true },
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "totally_fake" },
        "rule",
        undefined,
        "proj_one",
      ),
    ).not.toThrow();
  });
});

describe("assertRegisteredAttributesScoped", () => {
  const projectSchema = [
    { property: "userId", datatype: "string" as const },
    {
      property: "scoped",
      datatype: "string",
      // Cast — fixture type forbids `projects`, but the shared util reads it.
      projects: ["p2"],
    } as unknown as {
      property: string;
      datatype: "string";
      archived?: boolean;
    },
  ];

  it("does not run the scope loader when the setting is off", async () => {
    const ctx = makeContext({ requireRegisteredAttributes: false });
    const loadScope = jest.fn(async () => ["p1"]);
    await assertRegisteredAttributesScoped(
      ctx,
      { condition: JSON.stringify({ some_typo: "x" }) },
      "rule",
      undefined,
      loadScope,
    );
    expect(loadScope).not.toHaveBeenCalled();
  });

  it("does not run the scope loader when nothing attribute-bearing changed", async () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
    });
    const loadScope = jest.fn(async () => ["p1"]);
    const condition = JSON.stringify({ userId: "a" });
    await assertRegisteredAttributesScoped(
      ctx,
      { hashAttribute: "userId", condition },
      "rule",
      { hashAttribute: "userId", condition },
      loadScope,
    );
    expect(loadScope).not.toHaveBeenCalled();
  });

  it("skips the loader but still validates registration when project scoping is off", async () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
    });
    const loadScope = jest.fn(async () => ["p1"]);
    await expect(
      assertRegisteredAttributesScoped(
        ctx,
        { condition: JSON.stringify({ some_typo: "x" }) },
        "rule",
        undefined,
        loadScope,
      ),
    ).rejects.toThrow(BadRequestError);
    expect(loadScope).not.toHaveBeenCalled();
  });

  it("loads the scope and enforces it when a field changed", async () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
      attributeSchema: projectSchema,
    });
    const loadScope = jest.fn(async () => ["p1"]);
    await expect(
      assertRegisteredAttributesScoped(
        ctx,
        { condition: JSON.stringify({ scoped: "x" }) },
        "rule",
        undefined,
        loadScope,
      ),
    ).rejects.toThrow(/not part of this project's scope/);
    expect(loadScope).toHaveBeenCalledTimes(1);
  });

  it("passes when the loaded scope covers the attribute", async () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
      attributeSchema: projectSchema,
    });
    await expect(
      assertRegisteredAttributesScoped(
        ctx,
        { condition: JSON.stringify({ scoped: "x" }) },
        "rule",
        undefined,
        async () => ["p1", "p2"],
      ),
    ).resolves.toBeUndefined();
  });
});

describe("lazyAttributeScope", () => {
  it("runs the underlying load at most once", async () => {
    const load = jest.fn(async () => ["p1"]);
    const scope = lazyAttributeScope(load);
    await expect(scope()).resolves.toEqual(["p1"]);
    await expect(scope()).resolves.toEqual(["p1"]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
