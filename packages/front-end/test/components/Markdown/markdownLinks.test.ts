import {
  isAllowedHref,
  splitMarkdownLinks,
} from "@/components/Markdown/markdownLinks";

describe("isAllowedHref", () => {
  it.each([
    "/experiment/exp_1#overview",
    "/features/my-flag?v=2",
    "/",
    "https://example.com/flags",
    "http://example.com",
    "https://en.wikipedia.org/wiki/Function_(mathematics)",
  ])("allows %s", (href) => {
    expect(isAllowedHref(href)).toBe(true);
  });

  it.each([
    "//evil.com/x",
    "/\\evil.com",
    "https://",
    "http://",
    "javascript:alert(1)",
    "mailto:someone@example.com",
    "relative/path",
    "example.com",
  ])("rejects %s", (href) => {
    expect(isAllowedHref(href)).toBe(false);
  });
});

describe("splitMarkdownLinks", () => {
  it("returns plain text unchanged", () => {
    expect(splitMarkdownLinks("No links here.")).toEqual(["No links here."]);
  });

  it("splits text around allowed links", () => {
    expect(
      splitMarkdownLinks(
        "See [docs](https://example.com) or [this](/features/x).",
      ),
    ).toEqual([
      "See ",
      { label: "docs", href: "https://example.com" },
      " or ",
      { label: "this", href: "/features/x" },
      ".",
    ]);
  });

  it("keeps a destination containing parentheses whole", () => {
    expect(
      splitMarkdownLinks(
        "[F](https://en.wikipedia.org/wiki/Function_(mathematics))",
      ),
    ).toEqual([
      {
        label: "F",
        href: "https://en.wikipedia.org/wiki/Function_(mathematics)",
      },
    ]);
  });

  it("leaves disallowed links as their original text", () => {
    const text = "[a](//evil.com) [b](javascript:alert(1)) [c](https://)";
    expect(splitMarkdownLinks(text)).toEqual([text]);
  });

  it("links allowed destinations next to disallowed ones", () => {
    expect(splitMarkdownLinks("[bad](//evil.com) then [good](/ok)")).toEqual([
      "[bad](//evil.com) then ",
      { label: "good", href: "/ok" },
    ]);
  });
});
