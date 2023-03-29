import { UrlTargetType } from "../src/types/growthbook";
import { isURLTargeted } from "../src/util";

const cases: Array<[UrlTargetType, string, string, boolean]> = [
  ["exact", "https://www.example.com", "https://www.example.com", true],
  [
    "exact",
    "https://www.example.com/foo?bar=1",
    "https://www.example.com/foo?bar=1",
    true,
  ],
  ["exact", "https://www.example.com/foo?bar=1", "/foo?bar=1", true],
  [
    "exact",
    "https://www.example.com/foo?bar=1&baz=2",
    "https://www.example.com/foo?bar=1&baz=2",
    true,
  ],
  [
    "exact",
    "https://www.example.com/foo?bar=1&baz=2",
    "https://www.example.com/foo?baz=2&bar=1",
    false,
  ],
  [
    "exact",
    "https://www.example.com/foo?bar=1&baz=2",
    "https://www.example.com/foo?bar=1&baz=2&foo=3",
    false,
  ],
  [
    "exact",
    "https://www.example.com/foo",
    "https://www.example.com/foo?bar=1",
    false,
  ],
  ["exact", "https://www.example.com", "https://example.com", false],
  ["exact", "https://example.com", "https://www.example.com", false],
  ["exact", "https://wwwexample.com", "http://www.example.com", false],
  ["exact", "http://wwwexample.com", "https://www.example.com", false],
  ["regex", "https://www.example.com/post/123", "^/post/[0-9]+", true],
  ["regex", "https://www.example.com/post/abc", "^/post/[0-9]+", false],
  ["regex", "https://www.example.com/new/post/123", "^/post/[0-9]+", false],
];

describe("isURLTargeted", () => {
  it("returns false when there are no targeting rules", () => {
    expect(isURLTargeted("https://example.com/testing", [])).toEqual(false);
  });
  it("handles a mix of include and exclude rules", () => {
    const URL = `https://www.example.com`;

    const includeMatch = {
      type: "exact",
      include: true,
      pattern: URL,
    } as const;
    const excludeMatch = {
      type: "exact",
      include: false,
      pattern: URL,
    } as const;
    const includeNoMatch = {
      type: "exact",
      include: true,
      pattern: "https://wrong.com",
    } as const;
    const excludeNoMatch = {
      type: "exact",
      include: false,
      pattern: "https://another.com",
    } as const;

    // One include rule matches, one exclude rule matches
    expect(
      isURLTargeted(URL, [
        includeMatch,
        includeNoMatch,
        excludeMatch,
        excludeNoMatch,
      ])
    ).toEqual(false);

    // One include rule matches, no exclude rule matches
    expect(
      isURLTargeted(URL, [includeMatch, includeNoMatch, excludeNoMatch])
    ).toEqual(true);

    // No include rule matches, no exclude rule matches
    expect(isURLTargeted(URL, [includeNoMatch, excludeNoMatch])).toEqual(false);

    // No include rule matches, one exclude rule matches
    expect(
      isURLTargeted(URL, [includeNoMatch, excludeNoMatch, excludeMatch])
    ).toEqual(false);

    // Only exclude rules, none matches
    expect(isURLTargeted(URL, [excludeNoMatch, excludeNoMatch])).toEqual(true);

    // Only exclude rules, one matches
    expect(isURLTargeted(URL, [excludeNoMatch, excludeMatch])).toEqual(false);

    // Only include rules, none matches
    expect(isURLTargeted(URL, [includeNoMatch, includeNoMatch])).toEqual(false);

    // Only include rules, one matches
    expect(isURLTargeted(URL, [includeNoMatch, includeMatch])).toEqual(true);
  });

  it.each(cases)(
    "case %#: %s url: `%s` pattern: `%s`",
    (type, url, pattern, expected) => {
      expect(
        isURLTargeted(url, [
          {
            type,
            include: true,
            pattern,
          },
        ])
      ).toEqual(expected);
    }
  );
});
