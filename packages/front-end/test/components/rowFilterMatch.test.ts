import { RowFilter } from "shared/types/fact-table";
import {
  applyRowFilters,
  matchesRowFilter,
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

  it("is case-sensitive, matching LIKE on BigQuery and Postgres", () => {
    expect(
      match(chrome, { column: "browser", operator: "=", values: ["chrome"] }),
    ).toBe(false);
    expect(
      match(chrome, {
        column: "browser",
        operator: "contains",
        values: ["chrome"],
      }),
    ).toBe(false);
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
