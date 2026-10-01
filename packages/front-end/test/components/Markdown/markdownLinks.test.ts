import {
  isAllowedHref,
  splitMarkdownLinks,
} from "@/components/Markdown/markdownLinks";

describe("isAllowedHref", () => {
  it.each([
    ["/experiment/exp_1#overview", true],
    ["https://en.wikipedia.org/wiki/Function_(mathematics)", true],
    ["//evil.com", false],
    ["/\\evil.com", false],
    ["https:example.com", false],
    ["https://", false],
    ["javascript:alert(1)", false],
  ])("%s -> %s", (href, allowed) => {
    expect(isAllowedHref(href)).toBe(allowed);
  });
});

describe("splitMarkdownLinks", () => {
  it("links allowed destinations and leaves the rest as text", () => {
    expect(splitMarkdownLinks("[bad](//evil.com) or [good](/ok).")).toEqual([
      "[bad](//evil.com) or ",
      { label: "good", href: "/ok" },
      ".",
    ]);
  });
});
