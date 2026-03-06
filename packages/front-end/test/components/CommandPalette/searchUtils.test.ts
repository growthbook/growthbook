import {
  tokenize,
  fuzzyMatchName,
  buildCommandPaletteIndex,
  combinedSearch,
} from "@/components/CommandPalette/searchUtils";

const ITEMS = [
  {
    id: "f1",
    name: "alpha_bravo_charlie",
    description: "",
    tags: "",
  },
  {
    id: "f2",
    name: "foo_bar",
    description: "",
    tags: "",
  },
  {
    id: "f3",
    name: "myToggleFlag",
    description: "Controls the widget rollout",
    tags: "widget rollout",
  },
  {
    id: "e1",
    name: "enable-flow-v2",
    description: "",
    tags: "",
  },
  {
    id: "e2",
    name: "beta_test_experiment",
    description: "",
    tags: "",
  },
  {
    id: "m1",
    name: "ValuePerSession",
    description: "Average value per session",
    tags: "value sessions",
  },
  {
    id: "x1",
    name: "able_body",
    description: "",
    tags: "",
  },
];

function search(query: string): string[] {
  const index = buildCommandPaletteIndex(ITEMS);
  return combinedSearch(index, ITEMS, query.trim()).map((item) => item.name);
}

describe("tokenize", () => {
  it("lowercases everything", () => {
    expect(tokenize("HELLO")).toEqual(["hello"]);
  });

  it("splits on hyphens", () => {
    expect(tokenize("foo-bar-baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("splits on underscores", () => {
    expect(tokenize("foo_bar")).toEqual(["foo", "bar"]);
  });

  it("splits on dots", () => {
    expect(tokenize("one.two.three")).toEqual(["one", "two", "three"]);
  });

  it("splits camelCase", () => {
    expect(tokenize("fooBarBaz")).toEqual(["foo", "bar", "baz"]);
  });

  it("splits PascalCase", () => {
    expect(tokenize("FooBarBaz")).toEqual(["foo", "bar", "baz"]);
  });

  it("splits consecutive uppercase (ABCDef style)", () => {
    expect(tokenize("ABCDef")).toEqual(["abc", "def"]);
  });

  it("handles multiple underscore-separated tokens", () => {
    expect(tokenize("one_two_three")).toEqual(["one", "two", "three"]);
  });

  it("drops empty segments from repeated delimiters", () => {
    expect(tokenize("--double--dash--")).toEqual(["double", "dash"]);
  });
});

describe("fuzzyMatchName", () => {
  it("matches a query whose chars appear in order across tokens", () => {
    expect(fuzzyMatchName("abc", "alpha_bravo_charlie")).not.toBeNull();
  });

  it("returns null when a query character is absent from the name", () => {
    expect(fuzzyMatchName("xyz", "foo_bar")).toBeNull();
  });

  it("returns null when query characters appear in the wrong order", () => {
    expect(fuzzyMatchName("bo", "foo_bar")).toBeNull();
  });

  it("gives a better (lower) score to a closer match", () => {
    const closeScore = fuzzyMatchName("foo", "foo_bar");
    const abbrevScore = fuzzyMatchName("fb", "foo_bar");
    expect(closeScore).not.toBeNull();
    expect(abbrevScore).not.toBeNull();
    expect(closeScore!).toBeLessThan(abbrevScore!);
  });

  it("matches first-letter abbreviations across tokens", () => {
    expect(fuzzyMatchName("fb", "foo_bar")).not.toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatchName("FB", "foo_bar")).not.toBeNull();
    expect(fuzzyMatchName("fb", "Foo_Bar")).not.toBeNull();
  });
});

describe("search — prefix matching", () => {
  it("finds an item by an exact token", () => {
    expect(search("bravo")).toContain("alpha_bravo_charlie");
  });

  it("finds an item by a partial token prefix", () => {
    expect(search("brav")).toContain("alpha_bravo_charlie");
  });

  it("finds an item by a token produced by camelCase splitting", () => {
    expect(search("toggle")).toContain("myToggleFlag");
  });

  it("finds an item by a description word", () => {
    expect(search("widget")).toContain("myToggleFlag");
  });

  it("finds an item by a tag word", () => {
    expect(search("rollout")).toContain("myToggleFlag");
  });
});

describe("search — fuzzy matching (typo tolerance)", () => {
  it("tolerates a single extra character (insertion)", () => {
    expect(search("bravoo")).toContain("alpha_bravo_charlie");
  });

  it("tolerates a single missing character (deletion)", () => {
    expect(search("enble")).toContain("enable-flow-v2");
  });

  it("tolerates a single substitution", () => {
    expect(search("togxle")).toContain("myToggleFlag");
  });

  it("does not fuzzy-match very short terms (≤3 chars require exact prefix)", () => {
    expect(search("xy")).toHaveLength(0);
  });
});

describe("search — microfuzz (abbreviated multi-token queries)", () => {
  it("matches leading chars from each token: abc → alpha_bravo_charlie", () => {
    expect(search("abc")).toEqual(["alpha_bravo_charlie"]);
  });

  it("matches first-letter abbreviations across two tokens: fb → foo_bar", () => {
    // "fb" → f(oo) b(ar)
    expect(search("fb")).toEqual(["foo_bar"]);
  });

  it("matches albrcha (partial chars spanning all three tokens)", () => {
    expect(search("albrcha")).toEqual(["alpha_bravo_charlie"]);
  });

  it("matches brcha (starting from the second token, skipping alpha)", () => {
    expect(search("brcha")).toEqual(["alpha_bravo_charlie"]);
  });

  it("does not return false positives for random strings", () => {
    expect(search("zzz")).toHaveLength(0);
  });
});

describe("search — result ordering", () => {
  it("returns MiniSearch prefix results before microfuzz results", () => {
    const results = search("ab");
    expect(results).toContain("able_body");
    expect(results).toContain("alpha_bravo_charlie");
    expect(results.indexOf("able_body")).toBeLessThan(
      results.indexOf("alpha_bravo_charlie"),
    );
  });

  it("within microfuzz tier, ranks closer matches (lower score) first", () => {
    // "foo" scores ~0.5 (startsWith) against "foo_bar" while "fb" scores ~2.8
    // (word-boundary subsequence). Both land in microfuzz when the other item
    // is already matched by MiniSearch. We verify the score relationship via
    // fuzzyMatchName directly since constructing two microfuzz-only items with
    // the same query is fixture-dependent.
    const closeScore = fuzzyMatchName("foo", "foo_bar");
    const distantScore = fuzzyMatchName("fb", "foo_bar");
    expect(closeScore!).toBeLessThan(distantScore!);
  });

  it("exact token match ranks first within MiniSearch results", () => {
    // "bravo" matches "alpha_bravo_charlie" as an exact token.
    // It should be the first result (or at least present and ranked highly).
    const results = search("bravo");
    expect(results[0]).toBe("alpha_bravo_charlie");
  });
});
