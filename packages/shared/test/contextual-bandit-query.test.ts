import {
  cbaqAttributeValidator,
  contextualBanditQueryValidator,
} from "../src/validators/contextual-bandit-query";

describe("contextualBanditQueryValidator", () => {
  const baseAttribute = {
    name: "Country",
    column: "country",
    datatype: "string" as const,
    topValues: ["US", "CA"],
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    dateUpdated: new Date("2025-01-02T00:00:00Z"),
    deleted: false,
  };

  it("parses a valid CBAQ document", () => {
    const doc = {
      id: "cbaq_promo",
      organization: "org_123",
      datasource: "ds_main",
      name: "Promo CBAQ",
      identifierType: "user_id",
      sql: "SELECT user_id, country FROM cb_assignments",
      attributes: [baseAttribute],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    expect(() => contextualBanditQueryValidator.parse(doc)).not.toThrow();
  });

  it("rejects an attribute with datatype boolean", () => {
    expect(() =>
      cbaqAttributeValidator.parse({
        ...baseAttribute,
        datatype: "boolean",
      }),
    ).toThrow();
  });

  it("defaults attributes to []", () => {
    const parsed = contextualBanditQueryValidator.parse({
      id: "cbaq_x",
      organization: "org_1",
      datasource: "ds_1",
      name: "x",
      identifierType: "user_id",
      sql: "SELECT 1",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    expect(parsed.attributes).toEqual([]);
  });
});
