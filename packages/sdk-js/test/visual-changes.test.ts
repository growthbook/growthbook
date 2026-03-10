import { GrowthBook } from "../src";
import {
  AutoExperiment,
  UrlTarget,
  UrlTargetType,
} from "../src/types/growthbook";
import { isURLTargeted } from "../src/util";

function sleep(ms = 20) {
  return new Promise((res) => setTimeout(res, ms));
}

global.structuredClone = (val) => JSON.parse(JSON.stringify(val));

const cases: Array<[UrlTargetType, string, string, boolean]> = [
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
      type: "simple",
      include: true,
      pattern: URL,
    } as const;
    const excludeMatch = {
      type: "simple",
      include: false,
      pattern: URL,
    } as const;
    const includeNoMatch = {
      type: "simple",
      include: true,
      pattern: "https://wrong.com",
    } as const;
    const excludeNoMatch = {
      type: "simple",
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
      ]),
    ).toEqual(false);

    // One include rule matches, no exclude rule matches
    expect(
      isURLTargeted(URL, [includeMatch, includeNoMatch, excludeNoMatch]),
    ).toEqual(true);

    // No include rule matches, no exclude rule matches
    expect(isURLTargeted(URL, [includeNoMatch, excludeNoMatch])).toEqual(false);

    // No include rule matches, one exclude rule matches
    expect(
      isURLTargeted(URL, [includeNoMatch, excludeNoMatch, excludeMatch]),
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

  it("supports an exclude rule on top of an include rule", () => {
    const rules: UrlTarget[] = [
      {
        include: true,
        type: "simple",
        pattern: "/search",
      },
      {
        include: false,
        type: "simple",
        pattern: "/search?bad=true",
      },
    ];

    expect(isURLTargeted("https://example.com/search", rules)).toEqual(true);
    expect(isURLTargeted("https://example.com/search?bad=true", rules)).toEqual(
      false,
    );
    expect(
      isURLTargeted("https://example.com/search?good=true", rules),
    ).toEqual(true);
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
        ]),
      ).toEqual(expected);
    },
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
      "<style>h1 { color: red; }</style>",
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
      "<style>h1 { color: red; }</style>",
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
      "<style>h1 { color: red; }</style>",
    );

    gb.destroy();
  });

  it("supports multi-page experiments", async () => {
    document.body.innerHTML = "<h1>title</h1>";

    const gb = new GrowthBook({
      attributes: { id: "1" },
      experiments: [
        {
          key: "my-experiment",
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              domMutations: [
                {
                  selector: "h1",
                  action: "set",
                  attribute: "html",
                  value: "page1",
                },
              ],
            },
          ],
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "example.com",
            },
          ],
        },
        {
          key: "my-experiment",
          weights: [0.1, 0.9],
          variations: [
            {},
            {
              domMutations: [
                {
                  selector: "h1",
                  action: "set",
                  attribute: "html",
                  value: "page2",
                },
              ],
            },
          ],
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "example.com/page2",
            },
          ],
        },
      ],
      url: "https://example.com",
    });

    // Changes should be applied right away for the first page
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>page1</h1>");

    // Simulate a navigation
    document.body.innerHTML = "<h1>new title</h1>";
    gb.setURL("https://example.com/page2");

    // Changes should be applied to the second page
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>page2</h1>");

    // Simulate another navigation to a non-tested page
    document.body.innerHTML = "<h1>another title</h1>";
    gb.setURL("https://example.com/page3");

    // The experiment should be reverted and the navigated page title should be live
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>another title</h1>");

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
      "<style>h1 { color: green; }</style>",
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
      "<style>h1 { color: blue; }</style>",
    );

    gb.destroy();
  });

  it("reverts auto experiments if they are no longer in the experiments array", async () => {
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
      "<style>h1 { color: red; }</style>",
    );

    // Changes are undone when the experiment is removed from the instance
    gb.setExperiments([]);
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    gb.destroy();
  });

  it("Skips experiments when they are in blockedChangeIds", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const experiments: AutoExperiment[] = [
      {
        changeId: "foo",
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
    ];

    // Blocked
    const gb = new GrowthBook({
      attributes: { id: "1" },
      blockedChangeIds: ["bar", "foo"],
      url: "http://www.example.com/home",
    });
    await gb.init({ payload: { experiments } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Not blocked
    experiments[0].changeId = "baz";
    await gb.setPayload({ experiments });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>",
    );

    // Blocked again
    experiments[0].changeId = "bar";
    await gb.setPayload({ experiments });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    gb.destroy();
  });

  it("Never blocks feature flag rule experiments", async () => {
    // Not blocked
    const gb = new GrowthBook({
      attributes: { id: "1" },
      blockedChangeIds: ["bar", "foo"],
      disableCrossOriginUrlRedirectExperiments: true,
      disableExperimentsOnLoad: true,
      disableJsInjection: true,
      disableUrlRedirectExperiments: true,
      disableVisualExperiments: true,
      url: "http://www.example.com/home",
    });
    await gb.init({
      payload: {
        features: {
          foo: {
            defaultValue: 0,
            rules: [
              {
                weights: [0, 1],
                variations: [0, 1],
                hashVersion: 2,
              },
            ],
          },
        },
      },
    });

    expect(gb.getFeatureValue("foo", -1)).toEqual(1);

    gb.destroy();
  });

  it("Skips various experiments and changes based on the context", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const experiments: AutoExperiment[] = [
      {
        key: "my-experiment",
        urlPatterns: [
          {
            type: "regex",
            include: true,
            pattern: "home",
          },
        ],
        weights: [0, 1],
        variations: [
          {},
          {
            css: "h1 { color: red; }",
            js: "/* something */",
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
    ];

    // Nothing blocked
    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
    });
    gb.init({ payload: { experiments } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>" + "<script>/* something */</script>",
    );
    gb.destroy();
    await sleep();

    // Blocked visual changes
    const gb2 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      disableVisualExperiments: true,
    });
    gb2.init({ payload: { experiments } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");
    gb2.destroy();
    await sleep();

    // Blocked JS changes, entire experiment should be blocked
    const gb3 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      disableJsInjection: true,
    });
    gb3.init({ payload: { experiments } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");
    gb3.destroy();
    await sleep();

    // Blocked JS changes, experiment without js changes should be allowed
    const gb4 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      disableJsInjection: true,
    });
    const experimentsWithoutJs = structuredClone(experiments);
    experimentsWithoutJs[0].variations[1].js = "";
    gb4.init({ payload: { experiments: experimentsWithoutJs } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>",
    );
    gb4.destroy();
    await sleep();

    // Adds a nonce to the script tag and doesn't run experiments automatically
    const gb5 = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      jsInjectionNonce: "123",
      disableExperimentsOnLoad: true,
    });
    gb5.init({ payload: { experiments } });
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // Run the experiments manually
    gb5.triggerAutoExperiments();
    await sleep();
    expect(document.body.innerHTML).toEqual("<h1>new</h1>");
    expect(document.head.innerHTML).toEqual(
      "<style>h1 { color: red; }</style>" +
        '<script nonce="123">/* something */</script>',
    );
    gb5.destroy();
  });

  it("Uses custom domChanges callback", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>title</h1>";

    const experiments: AutoExperiment[] = [
      {
        key: "my-experiment",
        weights: [0, 1],
        urlPatterns: [
          {
            type: "regex",
            include: true,
            pattern: "home",
          },
        ],
        variations: [
          {},
          {
            css: "h1 { color: red; }",
            js: "/* something */",
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
    ];

    const undo = jest.fn();
    const cb = jest.fn(() => () => undo());

    const gb = new GrowthBook({
      attributes: { id: "1" },
      url: "http://www.example.com/home",
      applyDomChangesCallback: cb,
    });
    await gb.init({ payload: { experiments } });
    await sleep();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(0);
    expect(cb).toHaveBeenCalledWith({
      css: "h1 { color: red; }",
      js: "/* something */",
      domMutations: [
        {
          selector: "h1",
          action: "set",
          attribute: "html",
          value: "new",
        },
      ],
    });

    // The page should not have been updated
    expect(document.body.innerHTML).toEqual("<h1>title</h1>");
    expect(document.head.innerHTML).toEqual("");

    // When undoing changes, the undo function should be called
    gb.destroy();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
