// Simple SQL tokenizer used to approximate syntax highlighting
// without having to load the full Prism highlighter.
// This ensures the page does not crash when we render 60 queries with 4k+ lines each at once

type SqlTokenType = "comment" | "string" | "number" | "keyword";

type SqlSegment =
  | { type: "text"; value: string }
  | { type: SqlTokenType; value: string };

const sqlTokenRegex =
  /(--[^\n]*|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\b(?:WITH|SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|AND|OR|NOT|NULL|CASE|WHEN|THEN|ELSE|END|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|COUNT|SUM|AVG|MIN|MAX|COALESCE|CAST|BETWEEN|IN|IS|LIKE|INTERVAL|TIMESTAMP|DATE)\b|\b\d+(?:\.\d+)?\b)/gi;

export function getSqlTokenType(token: string): SqlTokenType {
  if (token.startsWith("--")) return "comment";
  if (token.startsWith("'") || token.startsWith('"') || token.startsWith("`")) {
    return "string";
  }
  if (/^\d/.test(token)) return "number";
  return "keyword";
}

export function tokenizeSql(code: string): SqlSegment[] {
  const segments: SqlSegment[] = [];
  let lastIndex = 0;

  for (const match of code.matchAll(sqlTokenRegex)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push({ type: "text", value: code.slice(lastIndex, index) });
    }

    segments.push({ type: getSqlTokenType(token), value: token });
    lastIndex = index + token.length;
  }

  if (lastIndex < code.length) {
    segments.push({ type: "text", value: code.slice(lastIndex) });
  }

  return segments;
}
