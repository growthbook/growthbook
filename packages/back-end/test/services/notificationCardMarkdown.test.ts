import {
  escapeInlineMarkdown,
  markdownToPlainText,
  parseInlineMarkdown,
} from "back-end/src/services/notificationCards/markdown";

describe("notification card markdown", () => {
  it("parses the inline marks the cards render", () => {
    expect(
      parseInlineMarkdown("Variation *One-page* **won** via `flag` [docs](x)"),
    ).toEqual([
      { text: "Variation " },
      { text: "One-page", italic: true },
      { text: " " },
      { text: "won", bold: true },
      { text: " via " },
      { text: "flag", code: true },
      { text: " docs" },
    ]);
  });

  it("leaves snake_case identifiers alone", () => {
    expect(parseInlineMarkdown("checkout_rate vs add_to_cart")).toEqual([
      { text: "checkout_rate vs add_to_cart" },
    ]);
  });

  it.each([
    "2*_fast_*",
    "*Ship it*",
    "50% off **today**",
    "a\\b",
    "- leading dash",
    "# heading",
    "[link](http://x)",
    "`code`",
  ])("round-trips %s through escape and plain text", (name) => {
    const escaped = escapeInlineMarkdown(name);
    expect(markdownToPlainText(escaped)).toBe(name);
    expect(parseInlineMarkdown(`Variation *${escaped}* won.`)).toEqual([
      { text: "Variation " },
      { text: name, italic: true },
      { text: " won." },
    ]);
  });

  it("flattens marks for text channels", () => {
    expect(markdownToPlainText("Variation *X* **won**.")).toBe(
      "Variation X won.",
    );
  });
});
