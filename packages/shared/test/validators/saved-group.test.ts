import {
  isInternalAttributeName,
  REMOTE_GROUP_IDS_ATTRIBUTE,
} from "../../src/constants";
import { isRemoteGroupSupportedAttribute } from "../../src/util/saved-groups";
import { postSavedGroupBodyValidator } from "../../src/validators/saved-group";
import { listSavedGroupUploadsValidator } from "../../src/validators/remote-saved-group-upload";

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

describe("isInternalAttributeName", () => {
  it("recognizes GrowthBook's internal attributes by their prefix", () => {
    expect(isInternalAttributeName(REMOTE_GROUP_IDS_ATTRIBUTE)).toBe(true);
    expect(isInternalAttributeName("account_id")).toBe(false);
    expect(isInternalAttributeName("__remoteGroupIds")).toBe(false);
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

describe("listSavedGroupUploadsValidator", () => {
  it("accepts a page of uploads with pagination fields", () => {
    expect(
      listSavedGroupUploadsValidator.responseSchema.safeParse({
        uploads: [],
        limit: 10,
        offset: 0,
        count: 0,
        total: 0,
        hasMore: false,
        nextOffset: null,
      }).success,
    ).toBe(true);
  });
});
