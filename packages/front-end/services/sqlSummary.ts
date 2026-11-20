const SQL_KEYWORDS = new Set(
  (
    "SELECT FROM WHERE AND OR NOT AS ON IN IS NULL BETWEEN LIKE ILIKE JOIN " +
    "LEFT RIGHT INNER OUTER FULL CROSS GROUP BY ORDER HAVING LIMIT OFFSET " +
    "UNION ALL DISTINCT WITH CASE WHEN THEN ELSE END QUALIFY OVER PARTITION " +
    "ASC DESC CAST TRUE FALSE"
  ).split(" "),
);

export type SqlSummaryToken = {
  text: string;
  kind: "keyword" | "string" | "variable" | "cast" | "muted" | "other";
  spaceBefore: boolean;
};

/**
 * One-line summary of a SQL query as tokens, with comments dropped and
 * whitespace collapsed. Every SELECT list that ends at a FROM, including ones
 * in subqueries and CTEs, is shortened to "…". Pass `backslashEscapes` for
 * dialects where `\'` escapes a quote (see usesBackslashStringEscapes).
 */
export function getSqlSummaryTokens(
  sql: string,
  backslashEscapes = false,
): SqlSummaryToken[] {
  const tokens: SqlSummaryToken[] = [];
  // SELECTs still waiting for their FROM: index of the SELECT token and depth
  const selects: { index: number; depth: number }[] = [];
  let depth = 0;
  let space = false;
  let i = 0;
  const push = (text: string, kind: SqlSummaryToken["kind"] = "other") => {
    tokens.push({ text, kind, spaceBefore: space && tokens.length > 0 });
    space = false;
  };
  const skipTo = (end: string, from: number) => {
    const j = sql.indexOf(end, from);
    return j < 0 ? sql.length : j + end.length;
  };
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) {
      space = true;
      i++;
    } else if (sql.startsWith("--", i)) {
      space = true;
      i = skipTo("\n", i);
    } else if (sql.startsWith("/*", i)) {
      space = true;
      i = skipTo("*/", i + 2);
    } else if (sql.startsWith("{{", i)) {
      const j = skipTo("}}", i + 2);
      push(sql.slice(i, j), "variable");
      i = j;
    } else if (sql.startsWith("::", i) && /[A-Za-z_]/.test(sql[i + 2] || "")) {
      let j = i + 3;
      while (j < sql.length && /\w/.test(sql[j])) j++;
      push(sql.slice(i, j), "cast");
      i = j;
    } else if (c === "'" || c === '"' || c === "`") {
      // Quotes are escaped by doubling, so a doubled quote just continues
      let j = i + 1;
      while (j < sql.length) {
        if (backslashEscapes && c !== "`" && sql[j] === "\\") j += 2;
        else if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      // A quoted string may hold a {{variable}}; keep it one string token
      push(sql.slice(i, j + 1), c === "'" ? "string" : "other");
      i = j + 1;
    } else if (/[\w$]/.test(c)) {
      let j = i + 1;
      while (j < sql.length && /[\w$]/.test(sql[j])) j++;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      const open = selects[selects.length - 1];
      if (upper === "FROM" && open?.depth === depth) {
        selects.pop();
        tokens.splice(open.index + 1, tokens.length, {
          text: "…",
          kind: "muted",
          spaceBefore: true,
        });
        space = true;
      }
      if (upper === "SELECT") {
        // A SELECT without a FROM (as in UNION ALL SELECT 1) keeps its list
        if (open?.depth === depth) selects.pop();
        selects.push({ index: tokens.length, depth });
      }
      push(word, SQL_KEYWORDS.has(upper) ? "keyword" : "other");
      i = j;
    } else {
      if (c === "(") depth++;
      if (c === ")") {
        depth = Math.max(0, depth - 1);
        while (selects.length && selects[selects.length - 1].depth > depth) {
          selects.pop();
        }
      }
      push(c);
      i++;
    }
  }
  return tokens;
}

/** The summary from getSqlSummaryTokens as plain text */
export function getSqlSummary(sql: string, backslashEscapes = false): string {
  return getSqlSummaryTokens(sql, backslashEscapes)
    .map((t) => (t.spaceBefore ? " " : "") + t.text)
    .join("");
}
