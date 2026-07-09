import {
  getSqlTokenType,
  tokenizeSql,
} from "@/components/SyntaxHighlighting/sqlTokenizer";

describe("getSqlTokenType", () => {
  it("classifies line comments", () => {
    expect(getSqlTokenType("-- a comment")).toBe("comment");
  });

  it("classifies single-quoted strings, double-quoted and backtick identifiers", () => {
    expect(getSqlTokenType("'hello'")).toBe("string");
    expect(getSqlTokenType('"col"')).toBe("string");
    expect(getSqlTokenType("`col`")).toBe("string");
  });

  it("classifies integers and decimals as numbers", () => {
    expect(getSqlTokenType("42")).toBe("number");
    expect(getSqlTokenType("3.14")).toBe("number");
  });

  it("treats everything else as a keyword", () => {
    expect(getSqlTokenType("SELECT")).toBe("keyword");
  });
});

describe("tokenizeSql", () => {
  it("returns a single text segment when there is nothing to highlight", () => {
    expect(tokenizeSql("foo bar baz")).toEqual([
      { type: "text", value: "foo bar baz" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(tokenizeSql("")).toEqual([]);
  });

  it("highlights keywords case-insensitively", () => {
    expect(tokenizeSql("select")).toEqual([
      { type: "keyword", value: "select" },
    ]);
    expect(tokenizeSql("Select")).toEqual([
      { type: "keyword", value: "Select" },
    ]);
    expect(tokenizeSql("SELECT")).toEqual([
      { type: "keyword", value: "SELECT" },
    ]);
  });

  it("respects word boundaries so keyword substrings stay text", () => {
    // "SELECTED" contains "SELECT" but should not be tokenized as a keyword
    expect(tokenizeSql("SELECTED")).toEqual([
      { type: "text", value: "SELECTED" },
    ]);
    // "INTERVAL" must not be split into the "IN" keyword + "TERVAL"
    expect(tokenizeSql("INTERVAL")).toEqual([
      { type: "keyword", value: "INTERVAL" },
    ]);
  });

  it("interleaves keywords with surrounding text", () => {
    expect(tokenizeSql("SELECT x FROM t")).toEqual([
      { type: "keyword", value: "SELECT" },
      { type: "text", value: " x " },
      { type: "keyword", value: "FROM" },
      { type: "text", value: " t" },
    ]);
  });

  it("captures line comments to the end of the line only", () => {
    expect(tokenizeSql("SELECT 1 -- a note\nFROM t")).toEqual([
      { type: "keyword", value: "SELECT" },
      { type: "text", value: " " },
      { type: "number", value: "1" },
      { type: "text", value: " " },
      { type: "comment", value: "-- a note" },
      { type: "text", value: "\n" },
      { type: "keyword", value: "FROM" },
      { type: "text", value: " t" },
    ]);
  });

  it("handles single-quoted strings including escaped quotes", () => {
    expect(tokenizeSql("WHERE name = 'it''s ok'")).toEqual([
      { type: "keyword", value: "WHERE" },
      { type: "text", value: " name = " },
      { type: "string", value: "'it''s ok'" },
    ]);
  });

  it("does not treat keywords inside a string as keywords", () => {
    expect(tokenizeSql("'SELECT FROM'")).toEqual([
      { type: "string", value: "'SELECT FROM'" },
    ]);
  });

  it("highlights decimals and integers", () => {
    expect(tokenizeSql("LIMIT 100 OFFSET 2.5")).toEqual([
      { type: "keyword", value: "LIMIT" },
      { type: "text", value: " " },
      { type: "number", value: "100" },
      { type: "text", value: " " },
      { type: "keyword", value: "OFFSET" },
      { type: "text", value: " " },
      { type: "number", value: "2.5" },
    ]);
  });

  it("preserves the original input exactly when joining segments", () => {
    const samples = [
      "SELECT COUNT(*) AS n FROM users WHERE created > '2024-01-01' -- recent\nGROUP BY id",
      "weird   spacing\tand\nnewlines",
      "no_sql_here(just text)",
      "",
    ];
    for (const sample of samples) {
      const rebuilt = tokenizeSql(sample)
        .map((s) => s.value)
        .join("");
      expect(rebuilt).toBe(sample);
    }
  });
});
