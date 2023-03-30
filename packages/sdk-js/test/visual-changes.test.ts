import { GrowthBook } from "../src";
import { UrlTargetType } from "../src/types/growthbook";
import { isURLTargeted } from "../src/util";

function sleep(ms = 20) {
  return new Promise((res) => setTimeout(res, ms));
}

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
  ["exact", "http://www.example.com", "https://www.example.com", false],
  ["regex", "https://www.example.com/post/123", "^/post/[0-9]+", true],
  ["regex", "https://www.example.com/post/abc", "^/post/[0-9]+", false],
  ["regex", "https://www.example.com/new/post/123", "^/post/[0-9]+", false],
  [
    "regex",
    "https://www.example.com/new/post/123",
    "example\\.com.*/post/[0-9]+",
    true,
  ],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/foo", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/foo?baz=2", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/foo?foo=3", false],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/bar?baz=2", false],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "foo", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "*?baz=2&bar=1", true],
  [
    "simple",
    "https://www.example.com/foo?bar=1&baz=2",
    "*.example.com/foo",
    true,
  ],
  [
    "simple",
    "https://www.example.com/foo?bar=1&baz=2",
    "blah.example.com/foo",
    false,
  ],
  [
    "simple",
    "https://www.example.com/foo?bar=1&baz=2",
    "https://www.*.com/foo",
    true,
  ],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "*.example.com", false],
  [
    "simple",
    "https://www.example.com/foo?bar=1&baz=2",
    "http://www.example.com/foo",
    true,
  ],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "f", false],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "f*", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "*f*", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/foo/", true],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/foo/bar", false],
  ["simple", "https://www.example.com/foo?bar=1&baz=2", "/bar/foo", false],
  ["simple", "https://www.example.com/foo/bar/baz", "/foo/*/baz", true],
  ["simple", "https://www.example.com/foo/bar/(baz", "/foo/*", true],
  ["simple", "https://www.example.com/foo/bar/#test", "/foo/*", true],
  ["simple", "https://www.example.com/foo/#test", "/foo/", true],
  ["simple", "https://www.example.com/foo/#test", "/foo/#test", true],
  ["simple", "https://www.example.com/foo/#test", "/foo/#blah", false],
  ["simple", "/foo/bar/?baz=1", "http://example.com/foo/bar", false],
  ["simple", "/foo/bar/?baz=1", "/foo/bar", true],
  ["simple", "&??*&&(", "/foo/bar", false],
  ["simple", "&??*&&(", "((*)(*$&#@!!)))", false],
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

describe("Auto experiments", () => {
  it("applies visual changes", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      experiments: [
        {
          key: "my-experiment",
          urlPatterns: [
            {
              type: "regex",
              include: true,
              pattern: "home",
            },
          ],
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              css: "h1 { color: red; }",
              domMutations: [
                {
                  selector: "h1",
                  action: "set",
                  attribute: "html",
                  value: "new",
                },
              ],
            },
          ],
        },
      ],
    });

    // Changes applied immediately
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>"
    );

    // Changes are undone when the URL changes to something that no longer matches
    gb.setURL("http://www.example.com/news");
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Changes are re-applied when switching back to the right URL
    gb.setURL("http://www.example.com/home");
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>"
    );

    // Changes are undone when the GrowthBook instance is destroyed
    gb.destroy();
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");
  });

  it("supports manually triggered experiments", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const gb = new GrowthBook({
      attributes: { id: "1" },
      experiments: [
        {
          key: "my-experiment",
          weights: [0.1, 0.9],
          manual: true,
          variations: [
            {},
            {
              css: "h1 { color: red; }",
              domMutations: [
                {
                  selector: "h1",
                  action: "set",
                  attribute: "html",
                  value: "new",
                },
              ],
            },
          ],
        },
      ],
    });

    // Changes should not be applied right away
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Triggering a non-existant experiment does nothing
    gb.triggerExperiment("my-test");
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Triggering the actual experiment key causes the changes
    gb.triggerExperiment("my-experiment");
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>"
    );

    gb.destroy();
  });

  it("responds to changes in the experiment definition", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const gb = new GrowthBook({
      attributes: { id: "1" },
      experiments: [
        {
          key: "my-experiment",
          weights: [0.1, 0.9],
          manual: true,
          variations: [
            {},
            {
              css: "h1 { color: red; }",
              domMutations: [
                {
                  selector: "h1",
                  action: "set",
                  attribute: "html",
                  value: "new",
                },
              ],
            },
          ],
        },
      ],
    });

    // Changes should not be applied right away
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Changing the experiment definition will no update manual tests that haven't been triggered yet
    gb.setExperiments([
      {
        key: "my-experiment",
        weights: [0.1, 0.9],
        manual: true,
        variations: [
          {},
          {
            css: "h1 { color: green; }",
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "foo",
              },
            ],
          },
        ],
      },
    ]);
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Triggering the actual experiment key causes the changes to apply
    gb.triggerExperiment("my-experiment");
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>foo</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: green; }</style>"
    );

    // Now, changes to the experiment will apply immediately
    gb.setExperiments([
      {
        key: "my-experiment",
        weights: [0.1, 0.9],
        manual: true,
        variations: [
          {},
          {
            css: "h1 { color: blue; }",
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "really new",
              },
            ],
          },
        ],
      },
    ]);
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>really new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: blue; }</style>"
    );

    gb.destroy();
  });
});
