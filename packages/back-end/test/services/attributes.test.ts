import { assertRegisteredAttributes } from "back-end/src/services/attributes";
import { BadRequestError } from "back-end/src/util/errors";
import { ReqContext } from "back-end/types/request";

const makeContext = (
  overrides: Partial<{
    requireRegisteredAttributes: boolean;
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
});
