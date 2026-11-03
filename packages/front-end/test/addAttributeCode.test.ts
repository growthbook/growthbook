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

  it("highlights the attribute without a comment when the language has none", () => {
    const result = getAddAttributeCode("go", "plan");
    expect(result?.snippet.code).not.toContain("your other attributes");
    const lines = result?.snippet.code.split("\n") ?? [];
    expect(lines[(result?.highlightLine ?? 0) - 1]).toContain('"plan"');
  });
});
