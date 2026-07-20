// Brace-balanced splitting of a Go struct body into field statements, so an
// inline anonymous struct travels as one statement (inner body captured for
// recursion) instead of leaking its inner fields as siblings of the outer
// struct.

export type GoFieldStatement =
  | { kind: "scalar"; line: string }
  | {
      kind: "anon-struct";
      name: string;
      // "*" / "[]" wrappers between the field name and `struct`, e.g. "[]*".
      modifiers: string;
      innerBody: string;
      tag: string;
    };

const ANON_STRUCT_OPEN = /^([A-Za-z_]\w*)\s+((?:\*|\[\])*)struct\s*\{$/;

export function splitGoFieldStatements(body: string): GoFieldStatement[] {
  const stmts: GoFieldStatement[] = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const anon = line.match(ANON_STRUCT_OPEN);
    if (anon) {
      let depth = 1;
      const inner: string[] = [];
      let tag = "";
      while (depth > 0 && ++i < lines.length) {
        const trimmed = lines[i].trim();
        depth += countChar(trimmed, "{") - countChar(trimmed, "}");
        if (depth === 0) {
          tag = trimmed.replace(/^\}\s*/, "").replace(/^`|`$/g, "");
        } else {
          inner.push(lines[i]);
        }
      }
      stmts.push({
        kind: "anon-struct",
        name: anon[1],
        modifiers: anon[2],
        innerBody: inner.join("\n"),
        tag,
      });
      continue;
    }
    // A line that leaves a brace OPEN starts a multi-line embedded block we
    // can't model as a single field — skip it. But a line with balanced braces
    // is a complete field whose TYPE happens to contain braces (e.g.
    // `Meta interface{}`, `Extra map[string]interface{}`); pass it through as a
    // scalar so parseGoField/typeTokenToNode handle it (map → object,
    // interface{} → any + warning) instead of silently dropping it.
    if (countChar(line, "{") !== countChar(line, "}")) continue;
    stmts.push({ kind: "scalar", line });
  }
  return stmts;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}
