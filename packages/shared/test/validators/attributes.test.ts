import { apiAttributeValidator } from "../../src/validators/attributes";

describe("apiAttributeValidator — documentationUrl", () => {
  const baseAttribute = { property: "userId", datatype: "string" } as const;

  it("accepts a valid https URL", () => {
    const result = apiAttributeValidator.safeParse({
      ...baseAttribute,
      documentationUrl: "https://docs.example.com/attributes/userId",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid http URL", () => {
    const result = apiAttributeValidator.safeParse({
      ...baseAttribute,
      documentationUrl: "http://intranet.corp/docs",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plain string without a scheme", () => {
    const result = apiAttributeValidator.safeParse({
      ...baseAttribute,
      documentationUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: scheme URL", () => {
    const result = apiAttributeValidator.safeParse({
      ...baseAttribute,
      documentationUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("treats undefined documentationUrl as absent (valid)", () => {
    const result = apiAttributeValidator.safeParse({ ...baseAttribute });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentationUrl).toBeUndefined();
    }
  });
});
