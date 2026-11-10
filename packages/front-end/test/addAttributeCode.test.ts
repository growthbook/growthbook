import { getAddAttributeCode } from "@/components/SyntaxHighlighting/Snippets/TargetingAttributeCodeSnippet";

describe("getAddAttributeCode", () => {
  it("keeps a dotted name as one key by default", () => {
    const result = getAddAttributeCode("javascript", "address.country");
    expect(result?.snippet.code).toBe(
      [
        "growthbook.setAttributes({",
        "  // ...your other attributes",
        '  "address.country": "foo"',
        "});",
      ].join("\n"),
    );
    expect(result?.highlightLine).toBe(3);
  });

  it("nests a dotted name and highlights the leaf", () => {
    const result = getAddAttributeCode("python", "address.country", {
      nested: true,
      value: ["a", "b"],
    });
    expect(result?.snippet.code).toBe(
      [
        "gb.set_attributes({",
        "  # ...your other attributes",
        '  "address": {',
        '    "country": [',
        '      "a",',
        '      "b"',
        "    ]",
        "  }",
        "})",
      ].join("\n"),
    );
    expect(result?.highlightLine).toBe(4);
  });

  it("nests in each language's own syntax where JSON isn't valid code", () => {
    const result = getAddAttributeCode("android", "address.country", {
      nested: true,
    });
    expect(result?.snippet.code).toContain(
      'attrs.put("address", mapOf("country" to "foo"))',
    );
  });

  it("writes Flutter attributes as a Dart map", () => {
    const result = getAddAttributeCode("flutter", "address.country", {
      nested: true,
    });
    expect(result?.snippet.code).toBe(
      [
        "gb.setAttributes({",
        "  // ...your other attributes",
        '  "address": {',
        '    "country": "foo"',
        "  }",
        "});",
      ].join("\n"),
    );
  });

  it("keeps a nested object intact when Node.js substitutes request values", () => {
    const result = getAddAttributeCode("nodejs", "query.campaign", {
      nested: true,
      version: "1.4.0",
    });
    expect(result?.snippet.code).toContain('"query": {');
    expect(result?.snippet.code).toContain('"campaign": "foo"');
  });

  it("highlights the attribute without a comment when the language has none", () => {
    const result = getAddAttributeCode("go", "plan");
    expect(result?.snippet.code).not.toContain("your other attributes");
    const lines = result?.snippet.code.split("\n") ?? [];
    expect(lines[(result?.highlightLine ?? 0) - 1]).toContain('"plan"');
  });
});
