import {
  applyStepGroups,
  matchesGlob,
  stepGroupMatchCounts,
  stepGroupsForColumn,
  suggestJourneyStepGroups,
} from "shared/journeys";
import { globToLikePattern } from "shared/sql";
import { JourneyStepGroup } from "shared/validators";

describe("globToLikePattern", () => {
  it("maps * to % and ? to _", () => {
    expect(globToLikePattern("/article/*")).toBe("/article/%");
    expect(globToLikePattern("/u/?/edit")).toBe("/u/_/edit");
    expect(globToLikePattern("/a/*/b/*")).toBe("/a/%/b/%");
  });

  it("escapes LIKE metacharacters that appear literally in the glob", () => {
    // Without escaping, the literal % and _ would act as wildcards of their own.
    expect(globToLikePattern("/reports/50%_*")).toBe("/reports/50\\%\\_%");
    expect(globToLikePattern("/a\\b")).toBe("/a\\\\b");
  });

  it("honors a dialect-specific wildcard escape", () => {
    const bracketEscape = (v: string) => v.replace(/([%_[])/g, "[$1]");
    expect(globToLikePattern("/50%/*", bracketEscape)).toBe("/50[%]/%");
  });

  it("leaves a pattern with no wildcards untouched", () => {
    expect(globToLikePattern("/pricing")).toBe("/pricing");
  });
});

describe("matchesGlob", () => {
  it("anchors the match at both ends", () => {
    expect(matchesGlob("/article/123", "/article/*")).toBe(true);
    expect(matchesGlob("/blog/article/123", "/article/*")).toBe(false);
    expect(matchesGlob("/article/123/extra", "/article/*")).toBe(true);
  });

  it("does not treat a bare prefix as a match for prefix/*", () => {
    expect(matchesGlob("/article", "/article/*")).toBe(false);
  });

  it("treats ? as exactly one character", () => {
    expect(matchesGlob("/u/7/edit", "/u/?/edit")).toBe(true);
    expect(matchesGlob("/u/77/edit", "/u/?/edit")).toBe(false);
  });

  it("treats regex metacharacters in the pattern as literal", () => {
    expect(matchesGlob("/a.b", "/a.b")).toBe(true);
    expect(matchesGlob("/axb", "/a.b")).toBe(false);
    expect(matchesGlob("/price+tax", "/price+tax")).toBe(true);
  });
});

describe("stepGroupsForColumn", () => {
  const groups: JourneyStepGroup[] = [
    { column: "path", pattern: "/article/*" },
    { column: "referrer", pattern: "/r/*" },
    { column: "path", pattern: "/tag/*" },
  ];

  it("narrows to one column, preserving order", () => {
    expect(stepGroupsForColumn(groups, "path")).toEqual([
      { column: "path", pattern: "/article/*" },
      { column: "path", pattern: "/tag/*" },
    ]);
  });

  it("treats a missing stepGroups list as no rules", () => {
    expect(stepGroupsForColumn(undefined, "path")).toEqual([]);
  });
});

describe("applyStepGroups", () => {
  const rules: JourneyStepGroup[] = [
    { column: "path", pattern: "/article/2024/*" },
    { column: "path", pattern: "/article/*" },
  ];

  it("rewrites a matched value to the pattern itself", () => {
    expect(applyStepGroups("/article/hello-world", rules)).toBe("/article/*");
  });

  it("applies the first matching rule, not the most specific", () => {
    // Both rules match; array order decides, mirroring the SQL CASE.
    expect(applyStepGroups("/article/2024/hello", rules)).toBe(
      "/article/2024/*",
    );
    expect(applyStepGroups("/article/2024/hello", [...rules].reverse())).toBe(
      "/article/*",
    );
  });

  it("passes an unmatched value through unchanged", () => {
    expect(applyStepGroups("/subscribe", rules)).toBe("/subscribe");
  });

  it("is a no-op with no rules", () => {
    expect(applyStepGroups("/article/1", [])).toBe("/article/1");
  });
});

describe("stepGroupMatchCounts", () => {
  const sample = ["/article/2024/a", "/article/b", "/subscribe"];

  it("credits each value to the rule that actually labels it", () => {
    const { effective, matched } = stepGroupMatchCounts(sample, [
      { column: "path", pattern: "/article/2024/*" },
      { column: "path", pattern: "/article/*" },
    ]);
    expect(effective).toEqual([1, 1]);
    // The broad rule matches both articles, but only labels one of them.
    expect(matched).toEqual([1, 2]);
  });

  it("reports a shadowed rule as matching but never labeling", () => {
    const { effective, matched } = stepGroupMatchCounts(sample, [
      { column: "path", pattern: "/article/*" },
      { column: "path", pattern: "/article/2024/*" },
    ]);
    expect(effective).toEqual([2, 0]);
    expect(matched).toEqual([2, 1]);
  });

  it("reports zero for a rule nothing matches", () => {
    const { effective, matched } = stepGroupMatchCounts(sample, [
      { column: "path", pattern: "/promo/*" },
    ]);
    expect(effective).toEqual([0]);
    expect(matched).toEqual([0]);
  });

  it("ignores an empty pattern rather than matching everything", () => {
    const { effective, matched } = stepGroupMatchCounts(sample, [
      { column: "path", pattern: "" },
    ]);
    expect(effective).toEqual([0]);
    expect(matched).toEqual([0]);
  });

  it("returns empty arrays for no rules", () => {
    expect(stepGroupMatchCounts(sample, [])).toEqual({
      effective: [],
      matched: [],
    });
  });
});

describe("suggestJourneyStepGroups", () => {
  const patterns = (values: string[]) =>
    suggestJourneyStepGroups(values).map((s) => s.pattern);

  it("groups a dynamic article fan-out", () => {
    const values = [
      "/search",
      "/subscribe",
      ...Array.from({ length: 20 }, (_, i) => `/article/post-${i}`),
    ];
    expect(patterns(values)).toEqual(["/article/*"]);
  });

  it("leaves flat root-level navigation alone", () => {
    expect(patterns(["/pricing", "/about", "/help", "/", "/contact"])).toEqual(
      [],
    );
  });

  it("groups one level below a root page", () => {
    expect(patterns(["/pricing/cloud", "/pricing/self-host"])).toEqual([
      "/pricing/*",
    ]);
  });

  it("suggests a pattern from only two examples", () => {
    expect(patterns(["/article/a", "/article/b"])).toEqual(["/article/*"]);
  });

  it("walks deeper when a prefix has a single child", () => {
    expect(patterns(["/blog/2024/a", "/blog/2024/b"])).toEqual([
      "/blog/2024/*",
    ]);
  });

  it("keeps the broader pattern when one subsumes another", () => {
    const values = [
      "/a/b/one",
      "/a/b/two",
      "/a/c/three",
      "/a/c/four",
      "/a/d/five",
    ];
    expect(patterns(values)).toEqual(["/a/*"]);
  });

  it("ranks the biggest fan-out first", () => {
    const values = [
      ...Array.from({ length: 30 }, (_, i) => `/article/post-${i}`),
      "/pricing/cloud",
      "/pricing/self-host",
    ];
    expect(patterns(values)).toEqual(["/article/*", "/pricing/*"]);
  });

  it("groups values that differ only by query string", () => {
    const values = [
      "/search?q=shoes",
      "/search?q=hats",
      "/search?q=coats",
      "/subscribe",
    ];
    expect(patterns(values)).toEqual(["/search?*"]);
  });

  it("returns nothing for values that are not path-shaped", () => {
    expect(patterns(["Signup Completed", "Page Viewed", "Purchase"])).toEqual(
      [],
    );
  });

  it("reports coverage and the values each pattern collapses", () => {
    const [suggestion] = suggestJourneyStepGroups([
      "/article/a",
      "/article/b",
      "/subscribe",
    ]);
    expect(suggestion.pattern).toBe("/article/*");
    expect(suggestion.coverage).toBe(2);
    expect(suggestion.matchedValues).toEqual(["/article/a", "/article/b"]);
  });

  it("ignores duplicates and empty values", () => {
    const values = ["/article/a", "/article/a", "/article/b", "", ""];
    const [suggestion] = suggestJourneyStepGroups(values);
    expect(suggestion.coverage).toBe(2);
  });

  it("caps the number of suggestions", () => {
    const values = Array.from({ length: 12 }, (_, g) => [
      `/g${g}/one`,
      `/g${g}/two`,
    ]).flat();
    expect(suggestJourneyStepGroups(values)).toHaveLength(5);
  });

  it("every suggested pattern actually matches the values it claims", () => {
    const values = [
      ...Array.from({ length: 10 }, (_, i) => `/article/post-${i}`),
      "/pricing/cloud",
      "/pricing/self-host",
      "/search?q=a",
      "/search?q=b",
    ];
    for (const s of suggestJourneyStepGroups(values)) {
      expect(s.matchedValues.every((v) => matchesGlob(v, s.pattern))).toBe(
        true,
      );
    }
  });
});
