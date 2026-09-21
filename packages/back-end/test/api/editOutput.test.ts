import {
  appendSkipped,
  mergeGlobalCss,
} from "back-end/src/api/visual-editor-ai/editOutput";

describe("mergeGlobalCss", () => {
  const existing = "body { background: red; }";

  it("appends new rules after the existing stylesheet", () => {
    expect(
      mergeGlobalCss({
        existing,
        replace: null,
        append: "button { color: pink; }",
      }),
    ).toBe("body { background: red; }\n\nbutton { color: pink; }");
  });

  it("appends onto an empty stylesheet without a leading separator", () => {
    expect(
      mergeGlobalCss({
        existing: undefined,
        replace: null,
        append: "a { color: red; }",
      }),
    ).toBe("a { color: red; }");
  });

  it("uses a rewrite as the base and appends after it", () => {
    expect(
      mergeGlobalCss({
        existing,
        replace: "body { background: blue; }",
        append: "a { color: red; }",
      }),
    ).toBe("body { background: blue; }\n\na { color: red; }");
  });

  it("returns undefined when a rewrite matches the saved stylesheet", () => {
    expect(
      mergeGlobalCss({ existing, replace: existing, append: null }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing was returned", () => {
    expect(
      mergeGlobalCss({ existing, replace: null, append: null }),
    ).toBeUndefined();
  });

  it("never wipes the stylesheet on an empty rewrite", () => {
    expect(
      mergeGlobalCss({ existing, replace: "", append: null }),
    ).toBeUndefined();
    expect(
      mergeGlobalCss({ existing, replace: "  ", append: "" }),
    ).toBeUndefined();
  });

  it("drops an appended rule the stylesheet already contains", () => {
    expect(
      mergeGlobalCss({ existing, replace: null, append: existing }),
    ).toBeUndefined();
    expect(
      mergeGlobalCss({
        existing: `/* hero */\n${existing}\n\na { color: red; }`,
        replace: null,
        append: existing,
      }),
    ).toBeUndefined();
  });

  it("keeps a rule that only appears as the tail of a longer selector", () => {
    const nav = ".nav button { color: pink; }";
    expect(
      mergeGlobalCss({
        existing: nav,
        replace: null,
        append: "button { color: pink; }",
      }),
    ).toBe(`${nav}\n\nbutton { color: pink; }`);
  });
});

describe("appendSkipped", () => {
  it("returns the explanation unchanged when nothing was skipped", () => {
    expect(appendSkipped("Done.", null)).toBe("Done.");
    expect(appendSkipped("Done.", [])).toBe("Done.");
  });

  it("lists each skipped part as a bullet below the explanation", () => {
    expect(
      appendSkipped("Swapped the images.", [
        {
          request: "Move the pricing section up",
          reason: "couldn't find it — click it so I can capture its selector",
        },
        { request: "Fix padding", reason: "" },
      ]),
    ).toBe(
      "Swapped the images.\n\n• Move the pricing section up — couldn't find it — click it so I can capture its selector\n• Fix padding",
    );
  });

  it("ignores entries with no request text", () => {
    expect(appendSkipped("Done.", [{ request: "  ", reason: "x" }])).toBe(
      "Done.",
    );
  });
});
