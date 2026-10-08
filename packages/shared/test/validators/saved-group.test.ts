import { REMOTE_GROUP_IDS_ATTRIBUTE } from "../../src/constants";
import { isRemoteGroupSupportedAttribute } from "../../src/util/saved-groups";
import {
  attributePropertyValidator,
  postAttributeValidator,
} from "../../src/validators/attributes";
import { postSavedGroupBodyValidator } from "../../src/validators/saved-group";

describe("remote saved group bodies", () => {
  const parse = (body: Record<string, unknown>) =>
    postSavedGroupBodyValidator.safeParse({
      groupName: "VIP accounts",
      owner: "",
      type: "remote",
      ...body,
    }).success;

  it("accepts an attributeKey", () => {
    expect(parse({ attributeKey: "account_id" })).toBe(true);
  });

  it("accepts empty values and condition", () => {
    expect(
      parse({ attributeKey: "account_id", values: [], condition: "" }),
    ).toBe(true);
  });

  it("requires an attributeKey", () => {
    expect(parse({})).toBe(false);
    expect(parse({ attributeKey: "" })).toBe(false);
  });

  it("rejects values and a condition", () => {
    expect(parse({ attributeKey: "account_id", values: ["a"] })).toBe(false);
    expect(parse({ attributeKey: "account_id", condition: '{"a":1}' })).toBe(
      false,
    );
  });

  it("leaves other types unchanged", () => {
    expect(parse({ type: "list", attributeKey: "id", values: ["a"] })).toBe(
      true,
    );
    expect(parse({ type: "condition", condition: '{"a":1}' })).toBe(true);
  });
});

describe("reserved attribute name", () => {
  it("rejects __remoteGroupIds", () => {
    expect(
      attributePropertyValidator.safeParse(REMOTE_GROUP_IDS_ATTRIBUTE).success,
    ).toBe(false);
    expect(
      postAttributeValidator.bodySchema.safeParse({
        property: REMOTE_GROUP_IDS_ATTRIBUTE,
        datatype: "string",
      }).success,
    ).toBe(false);
  });

  it("accepts other names", () => {
    expect(attributePropertyValidator.safeParse("account_id").success).toBe(
      true,
    );
  });
});

describe("isRemoteGroupSupportedAttribute", () => {
  it("allows string and number attributes", () => {
    expect(isRemoteGroupSupportedAttribute({ datatype: "string" })).toBe(true);
    expect(isRemoteGroupSupportedAttribute({ datatype: "number" })).toBe(true);
  });

  it("rejects secureString and other types", () => {
    expect(isRemoteGroupSupportedAttribute({ datatype: "secureString" })).toBe(
      false,
    );
    expect(isRemoteGroupSupportedAttribute({ datatype: "string[]" })).toBe(
      false,
    );
    expect(isRemoteGroupSupportedAttribute(undefined)).toBe(false);
  });

  it("rejects attributes without equality conditions", () => {
    expect(
      isRemoteGroupSupportedAttribute({
        datatype: "string",
        disableEqualityConditions: true,
      }),
    ).toBe(false);
  });
});
