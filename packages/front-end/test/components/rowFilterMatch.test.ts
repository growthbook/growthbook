import { RowFilter } from "shared/types/fact-table";
import {
  applyRowFilters,
  canNarrowLoadedRows,
  compileRowFilter,
  matchesRowFilter,
  rowFilterIsLocallyEvaluable,
} from "@/components/FactTables/rowFilterMatch";

type Row = { browser: string | null; user: string | null };

const getValue = (row: Row, column: string) =>
  column === "browser" ? row.browser : row.user;

const chrome: Row = { browser: "Chrome", user: "usr_0001" };
const safari: Row = { browser: "Safari", user: "usr_0002" };
const nullBrowser: Row = { browser: null, user: "usr_0003" };

const match = (row: Row, filter: RowFilter) =>
  matchesRowFilter(row, filter, getValue);

describe("matchesRowFilter", () => {
  it("handles equality and membership", () => {
    expect(
      match(chrome, { column: "browser", operator: "=", values: ["Chrome"] }),
    ).toBe(true);
    expect(
      match(safari, { column: "browser", operator: "=", values: ["Chrome"] }),
    ).toBe(false);
    expect(
      match(safari, { column: "browser", operator: "!=", values: ["Chrome"] }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "browser",
        operator: "in",
        values: ["Chrome", "Firefox"],
      }),
    ).toBe(true);
    expect(
      match(safari, {
        column: "browser",
        operator: "in",
        values: ["Chrome", "Firefox"],
      }),
    ).toBe(false);
    expect(
      match(safari, {
        column: "browser",
        operator: "not_in",
        values: ["Chrome", "Firefox"],
      }),
    ).toBe(true);
  });

  it("handles the substring operators", () => {
    expect(
      match(chrome, {
        column: "user",
        operator: "starts_with",
        values: ["usr_"],
      }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "user",
        operator: "ends_with",
        values: ["0001"],
      }),
    ).toBe(true);
    expect(
      match(chrome, { column: "user", operator: "contains", values: ["r_00"] }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "user",
        operator: "not_contains",
        values: ["zzz"],
      }),
    ).toBe(true);
    expect(
      match(chrome, { column: "user", operator: "contains", values: ["zzz"] }),
    ).toBe(false);
  });

  it("folds case on both sides, as every other client-side filter does", () => {
    expect(
      match(chrome, { column: "browser", operator: "=", values: ["chrome"] }),
    ).toBe(true);
    expect(
      match(chrome, { column: "browser", operator: "=", values: ["CHROME"] }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "browser",
        operator: "contains",
        values: ["HROM"],
      }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "browser",
        operator: "in",
        values: ["safari", "chrome"],
      }),
    ).toBe(true);
    expect(
      match(chrome, {
        column: "browser",
        operator: "matches_pattern",
        values: ["CHR*"],
      }),
    ).toBe(true);
  });

  describe("null values", () => {
    it("are selected only by is_null", () => {
      expect(
        match(nullBrowser, {
          column: "browser",
          operator: "is_null",
          values: [],
        }),
      ).toBe(true);
      expect(
        match(nullBrowser, {
          column: "browser",
          operator: "not_null",
          values: [],
        }),
      ).toBe(false);
      expect(
        match(chrome, { column: "browser", operator: "not_null", values: [] }),
      ).toBe(true);
    });

    it("fail negated operators too, as `NULL != 'x'` does in SQL", () => {
      // The trap: a value-less row looks like it "is not Chrome", but SQL
      // evaluates that to NULL and drops the row. Matching here would make the
      // client and the warehouse disagree.
      expect(
        match(nullBrowser, {
          column: "browser",
          operator: "!=",
          values: ["Chrome"],
        }),
      ).toBe(false);
      expect(
        match(nullBrowser, {
          column: "browser",
          operator: "not_contains",
          values: ["Chrome"],
        }),
      ).toBe(false);
      expect(
        match(nullBrowser, {
          column: "browser",
          operator: "not_in",
          values: ["Chrome"],
        }),
      ).toBe(false);
    });

    it("treats a missing column as null rather than throwing", () => {
      expect(
        matchesRowFilter(
          chrome,
          { column: "nope", operator: "is_null", values: [] },
          () => undefined,
        ),
      ).toBe(true);
    });
  });

  describe("matches_pattern", () => {
    it("treats * as any run and ? as exactly one character", () => {
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["usr_*"],
        }),
      ).toBe(true);
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["usr_000?"],
        }),
      ).toBe(true);
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["usr_00?"],
        }),
      ).toBe(false);
    });

    it("anchors the pattern, as LIKE matches the whole value", () => {
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["usr"],
        }),
      ).toBe(false);
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["*usr*"],
        }),
      ).toBe(true);
    });

    it("keeps regex and SQL metacharacters literal", () => {
      const row: Row = { browser: "a.c", user: "50%_x" };
      expect(
        match(row, {
          column: "browser",
          operator: "matches_pattern",
          values: ["a.c"],
        }),
      ).toBe(true);
      expect(
        match(row, {
          column: "browser",
          operator: "matches_pattern",
          values: ["abc"],
        }),
      ).toBe(false);
      // `%` and `_` are LIKE wildcards; the glob syntax is only * and ?.
      expect(
        match(row, {
          column: "user",
          operator: "matches_pattern",
          values: ["50%_x"],
        }),
      ).toBe(true);
      expect(
        match(row, {
          column: "user",
          operator: "matches_pattern",
          values: ["50%_y"],
        }),
      ).toBe(false);
    });

    it("collapses repeated wildcards rather than compounding backtracking", () => {
      // `*a*b*` and `**a**b**` select the same rows; the second must not cost
      // more to evaluate.
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["**usr**0001**"],
        }),
      ).toBe(true);
      expect(
        match(chrome, {
          column: "user",
          operator: "matches_pattern",
          values: ["**usr**9999**"],
        }),
      ).toBe(false);
    });

    it("negates with not_matches_pattern", () => {
      expect(
        match(safari, {
          column: "user",
          operator: "not_matches_pattern",
          values: ["usr_0001"],
        }),
      ).toBe(true);
    });
  });

  it("leaves rows alone for a filter only the warehouse can resolve", () => {
    // The panel can't create these; if one arrives anyway, the honest move is
    // to not guess and let the next Refresh apply it in SQL.
    expect(match(chrome, { operator: "sql_expr", values: ["1=1"] })).toBe(true);
    expect(match(chrome, { operator: "saved_filter", values: ["flt_1"] })).toBe(
      true,
    );
  });

  it("matches nothing for an operator outside the string set", () => {
    // Silently widening would show unfiltered rows as though they were filtered.
    expect(
      match(chrome, { column: "browser", operator: ">", values: ["A"] }),
    ).toBe(false);
    expect(
      match(chrome, { column: "browser", operator: "is_true", values: [] }),
    ).toBe(false);
  });
});

describe("applyRowFilters", () => {
  const rows = [chrome, safari, nullBrowser];

  it("ANDs every complete filter together", () => {
    expect(
      applyRowFilters(
        rows,
        [
          { column: "browser", operator: "not_null", values: [] },
          { column: "user", operator: "contains", values: ["000"] },
        ],
        getValue,
      ),
    ).toEqual([chrome, safari]);
  });

  it("skips an incomplete filter instead of blanking the table", () => {
    // Someone has picked a column but not yet typed a value.
    expect(
      applyRowFilters(
        rows,
        [{ column: "browser", operator: "=", values: [""] }],
        getValue,
      ),
    ).toEqual(rows);
    expect(
      applyRowFilters(
        rows,
        [{ column: "", operator: "=", values: ["x"] }],
        getValue,
      ),
    ).toEqual(rows);
  });

  it("returns the original array when nothing is active", () => {
    expect(applyRowFilters(rows, [], getValue)).toEqual(rows);
  });
});

describe("compileRowFilter", () => {
  it("compiles once and reuses the predicate across rows", () => {
    // The point of compiling: the pattern's RegExp is built once, not once per
    // row, which otherwise runs up to the whole loaded buffer per keystroke.
    let lookups = 0;
    const counting = (row: Row, column: string) => {
      lookups++;
      return getValue(row, column);
    };
    const matches = compileRowFilter<Row>(
      { column: "user", operator: "matches_pattern", values: ["usr_*"] },
      counting,
    );
    expect([chrome, safari, nullBrowser].filter(matches)).toHaveLength(3);
    expect(lookups).toBe(3);
  });
});

describe("matches_pattern performance", () => {
  it("does not blow up on a pattern of alternating wildcards and literals", () => {
    const pattern = "*a*a*a*a*a*a*a*a*a*a*b";
    const value = "a".repeat(20000);
    const started = Date.now();
    expect(
      match(
        { browser: value, user: null },
        { column: "browser", operator: "matches_pattern", values: [pattern] },
      ),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("glob anchoring edge cases", () => {
  const matchesPattern = (value: string, pattern: string) =>
    match(
      { browser: value, user: null },
      { column: "browser", operator: "matches_pattern", values: [pattern] },
    );

  it("anchors a trailing ?", () => {
    expect(matchesPattern("ab", "a?")).toBe(true);
    expect(matchesPattern("abc", "a?")).toBe(false);
    expect(matchesPattern("a", "a?")).toBe(false);
  });

  it("anchors a pattern with no wildcard at all", () => {
    expect(matchesPattern("ab", "ab")).toBe(true);
    expect(matchesPattern("abab", "ab")).toBe(false);
    expect(matchesPattern("xab", "ab")).toBe(false);
  });

  it("requires a single segment to reach both ends when both are anchored", () => {
    expect(matchesPattern("ab", "a*b")).toBe(true);
    expect(matchesPattern("axxb", "a*b")).toBe(true);
    expect(matchesPattern("a", "a*b")).toBe(false);
    expect(matchesPattern("ba", "a*b")).toBe(false);
  });

  it("handles stars at one end only", () => {
    expect(matchesPattern("abc", "a*")).toBe(true);
    expect(matchesPattern("bac", "a*")).toBe(false);
    expect(matchesPattern("xa", "*a")).toBe(true);
    expect(matchesPattern("ax", "*a")).toBe(false);
  });

  it("treats a bare star as match-all and an empty pattern as match-empty", () => {
    expect(matchesPattern("anything", "*")).toBe(true);
    expect(matchesPattern("", "*")).toBe(true);
    expect(matchesPattern("", "")).toBe(true);
    expect(matchesPattern("x", "")).toBe(false);
  });
});

describe("canNarrowLoadedRows", () => {
  const browserIsChrome: RowFilter = {
    column: "browser",
    operator: "=",
    values: ["chrome"],
  };
  const userHas000: RowFilter = {
    column: "user",
    operator: "contains",
    values: ["000"],
  };

  it("refuses when nothing is loaded", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: null,
        nextFilters: [],
        truncated: false,
      }),
    ).toBe(false);
  });

  it("allows an added filter over a complete buffer", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome],
        nextFilters: [browserIsChrome, userHas000],
        truncated: false,
      }),
    ).toBe(true);
  });

  it("allows the unchanged set", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome],
        nextFilters: [browserIsChrome],
        truncated: false,
      }),
    ).toBe(true);
  });

  it("refuses a truncated buffer, because narrowing could surface cut-off rows", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome],
        nextFilters: [browserIsChrome, userHas000],
        truncated: true,
      }),
    ).toBe(false);
  });

  it("refuses a removed filter", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome, userHas000],
        nextFilters: [browserIsChrome],
        truncated: false,
      }),
    ).toBe(false);
  });

  it("refuses a changed value", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome],
        nextFilters: [{ ...browserIsChrome, values: ["safari"] }],
        truncated: false,
      }),
    ).toBe(false);
  });

  it("ignores the order the filters are listed in", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome, userHas000],
        nextFilters: [userHas000, browserIsChrome],
        truncated: false,
      }),
    ).toBe(true);
  });

  it("matches duplicates as a multiset, not a set", () => {
    expect(
      canNarrowLoadedRows({
        loadedFilters: [browserIsChrome, browserIsChrome],
        nextFilters: [browserIsChrome],
        truncated: false,
      }),
    ).toBe(false);
  });

  it("refuses an added filter the client cannot evaluate", () => {
    // compileRowFilter treats these as match-everything and match-nothing
    // respectively, so narrowing locally would be wrong in both directions.
    expect(
      canNarrowLoadedRows({
        loadedFilters: [],
        nextFilters: [{ operator: "sql_expr", values: ["1 = 1"] }],
        truncated: false,
      }),
    ).toBe(false);
    expect(
      canNarrowLoadedRows({
        loadedFilters: [],
        nextFilters: [{ column: "user", operator: ">", values: ["5"] }],
        truncated: false,
      }),
    ).toBe(false);
  });
});

describe("rowFilterIsLocallyEvaluable", () => {
  it("accepts the string operators the panel offers", () => {
    expect(
      rowFilterIsLocallyEvaluable({
        column: "browser",
        operator: "contains",
        values: ["a"],
      }),
    ).toBe(true);
  });

  it("rejects operators whose value reaches the warehouse as raw SQL", () => {
    expect(
      rowFilterIsLocallyEvaluable({ operator: "sql_expr", values: ["1 = 1"] }),
    ).toBe(false);
    expect(
      rowFilterIsLocallyEvaluable({
        operator: "saved_filter",
        values: ["f_1"],
      }),
    ).toBe(false);
  });

  it("rejects a filter with no column", () => {
    expect(rowFilterIsLocallyEvaluable({ operator: "=", values: ["a"] })).toBe(
      false,
    );
  });
});
