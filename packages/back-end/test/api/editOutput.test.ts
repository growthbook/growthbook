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

  it("re-appends a rule that a later rule for the same selector overrides", () => {
    const sheet = "button { color: pink; }\n\nbutton { color: black; }";
    expect(
      mergeGlobalCss({
        existing: sheet,
        replace: null,
        append: "button { color: pink; }",
      }),
    ).toBe(`${sheet}\n\nbutton { color: pink; }`);
    // A later rule for a different selector leaves it in effect.
    expect(
      mergeGlobalCss({
        existing: "button { color: pink; }\n\n.nav button { color: black; }",
        replace: null,
        append: "button { color: pink; }",
      }),
    ).toBeUndefined();
  });

  it("judges each appended rule on its own", () => {
    // `a` is still in effect; `b` was overridden further down.
    const sheet =
      "a { color: red; }\n\nb { color: blue; }\n\nb { color: green; }";
    expect(
      mergeGlobalCss({
        existing: sheet,
        replace: null,
        append: "a { color: red; }\nb { color: blue; }",
      }),
    ).toBe(`${sheet}\n\nb { color: blue; }`);
  });

  it("keeps a nested block whole, with its leading comment", () => {
    const media =
      "/* phones */\n@media (max-width: 600px) {\n  a { color: red; }\n}";
    expect(mergeGlobalCss({ existing, replace: null, append: media })).toBe(
      `${existing}\n\n${media}`,
    );
    expect(
      mergeGlobalCss({
        existing: `${existing}\n\n${media}`,
        replace: null,
        append: media,
      }),
    ).toBeUndefined();
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
