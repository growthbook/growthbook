import { replaceSnippetConst } from "../scripts/docs-snippet-data";

const snippet = `export const Badge = ({ sdk }) => {
  const sdkInfo = {
    js: { name: "JS SDK", version: "1.0.0" },
  };

  const render = () => sdkInfo[sdk].name;
  return <span title="{}">{render()}</span>;
};
`;

describe("replaceSnippetConst", () => {
  it("replaces only the named literal and keeps the surrounding JSX", async () => {
    const out = await replaceSnippetConst(snippet, "sdkInfo", {
      js: { name: "JS SDK", version: "2.0.0" },
    });

    expect(out).toBe(`export const Badge = ({ sdk }) => {
  const sdkInfo = {
    js: {
      name: "JS SDK",
      version: "2.0.0",
    },
  };

  const render = () => sdkInfo[sdk].name;
  return <span title="{}">{render()}</span>;
};
`);
  });

  it("indents nested objects and arrays like the declaration", async () => {
    const out = await replaceSnippetConst(snippet, "sdkInfo", {
      js: {
        name: "JS SDK",
        capabilities: [{ features: "All versions" }, { streaming: "≥ v1.2" }],
      },
    });

    expect(out).toContain(`  const sdkInfo = {
    js: {
      name: "JS SDK",
      capabilities: [
        {
          features: "All versions",
        },
        {
          streaming: "≥ v1.2",
        },
      ],
    },
  };
`);
  });

  it("skips braces and escaped quotes inside strings", async () => {
    const source = `  const data = { a: "}{", b: 'it\\'s }', c: \`{\${x}}\` };\n  const after = 1;\n`;

    const out = await replaceSnippetConst(source, "data", { a: 1 });

    expect(out).toBe(`  const data = {\n    a: 1,\n  };\n  const after = 1;\n`);
  });

  it("is stable when run again on its own output", async () => {
    const value = { js: { name: "JS SDK", version: "2.0.0" } };
    const once = await replaceSnippetConst(snippet, "sdkInfo", value);

    expect(await replaceSnippetConst(once, "sdkInfo", value)).toBe(once);
  });

  it("throws when the declaration is missing", async () => {
    await expect(replaceSnippetConst(snippet, "missing", {})).rejects.toThrow(
      'No "const missing = {...}" to replace',
    );
  });

  it("throws when the declaration is not an object literal", async () => {
    await expect(
      replaceSnippetConst("const sdkInfo = load();", "sdkInfo", {}),
    ).rejects.toThrow("is not followed by an object literal");
  });

  it("throws on an unterminated object literal", async () => {
    await expect(
      replaceSnippetConst("const sdkInfo = { a: 1", "sdkInfo", {}),
    ).rejects.toThrow("Unterminated object literal");
  });
});
