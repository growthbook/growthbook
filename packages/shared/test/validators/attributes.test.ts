import {
  apiAttributeValidator,
  documentationUrlSchema,
  postAttributeValidator,
  putAttributeValidator,
} from "../../src/validators/attributes";

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

describe("documentationUrlSchema", () => {
  it("accepts a valid https URL", () => {
    expect(
      documentationUrlSchema.safeParse("https://docs.example.com/path").success,
    ).toBe(true);
  });

  it("accepts http://localhost:3000 (self-hosted use case)", () => {
    expect(
      documentationUrlSchema.safeParse("http://localhost:3000").success,
    ).toBe(true);
  });

  it("accepts a URL with port, query and fragment", () => {
    expect(
      documentationUrlSchema.safeParse("https://x.example.com:8080/p?q=1#frag")
        .success,
    ).toBe(true);
  });

  it("treats undefined as absent (valid)", () => {
    expect(documentationUrlSchema.safeParse(undefined).success).toBe(true);
  });

  it("normalizes an empty string to undefined (used to clear the field)", () => {
    const result = documentationUrlSchema.safeParse("");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it("rejects a javascript: scheme URL", () => {
    expect(
      documentationUrlSchema.safeParse("javascript:alert(1)").success,
    ).toBe(false);
  });

  it("rejects an ftp: scheme URL", () => {
    expect(documentationUrlSchema.safeParse("ftp://example.com").success).toBe(
      false,
    );
  });

  it("rejects a data: scheme URL", () => {
    expect(
      documentationUrlSchema.safeParse(
        "data:text/html,<script>alert(1)</script>",
      ).success,
    ).toBe(false);
  });

  it("rejects a mailto: scheme URL", () => {
    expect(documentationUrlSchema.safeParse("mailto:a@b.com").success).toBe(
      false,
    );
  });

  it("rejects a file: scheme URL", () => {
    expect(documentationUrlSchema.safeParse("file:///etc/passwd").success).toBe(
      false,
    );
  });

  it("rejects a plain string without a scheme", () => {
    expect(documentationUrlSchema.safeParse("docs.example.com").success).toBe(
      false,
    );
  });
});

describe("postAttributeValidator.bodySchema", () => {
  const minimalValid = { property: "userId", datatype: "string" } as const;

  it("accepts a minimal payload without documentationUrl", () => {
    const result = postAttributeValidator.bodySchema.safeParse(minimalValid);
    expect(result.success).toBe(true);
  });

  it("accepts a payload with a valid documentationUrl", () => {
    const result = postAttributeValidator.bodySchema.safeParse({
      ...minimalValid,
      documentationUrl: "https://docs.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key (strict object)", () => {
    const result = postAttributeValidator.bodySchema.safeParse({
      ...minimalValid,
      unknownField: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("putAttributeValidator.bodySchema", () => {
  it("accepts a partial update with only documentationUrl", () => {
    const result = putAttributeValidator.bodySchema.safeParse({
      documentationUrl: "https://docs.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty-string documentationUrl as a clear signal", () => {
    const result = putAttributeValidator.bodySchema.safeParse({
      documentationUrl: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Empty string is normalized to undefined so the field can be removed
      expect(result.data.documentationUrl).toBeUndefined();
      expect("documentationUrl" in result.data).toBe(true);
    }
  });

  it("accepts a partial update with only description", () => {
    const result = putAttributeValidator.bodySchema.safeParse({
      description: "new description",
    });
    expect(result.success).toBe(true);
  });

  it("accepts datatype + documentationUrl together", () => {
    const result = putAttributeValidator.bodySchema.safeParse({
      datatype: "string",
      documentationUrl: "https://docs.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown key (strict object)", () => {
    const result = putAttributeValidator.bodySchema.safeParse({
      unknownField: "x",
    });
    expect(result.success).toBe(false);
  });
});
