// A JSON field is either a key sampled from warehouse rows (untrusted, may
// contain any character) or a path someone typed into the column editor
// (`user.plan`, `items[0].name`, `"a.b"`, `items[*]`). Parse the path so
// existing syntax is kept as written and only bare keys that can't be written
// bare get quoted.

export type JsonPathStep =
  | { kind: "member"; raw: string; name: string; quote: "" | '"' | "`" }
  | { kind: "subscript"; raw: string; inner: string };

// Bare members that every engine reads as a plain key (or wildcard).
const BARE_MEMBER = /^[A-Za-z0-9_$*]+$/;

function readQuoted(path: string, start: number): number {
  const quote = path[start];
  for (let i = start + 1; i < path.length; i++) {
    if (path[i] === "\\") i++;
    else if (path[i] === quote) return i + 1;
  }
  return -1;
}

// Returns null when the path isn't well-formed member/subscript syntax.
export function parseJsonPath(path: string): JsonPathStep[] | null {
  const steps: JsonPathStep[] = [];
  let i = 0;
  while (i <= path.length) {
    const start = i;
    let name: string;
    let quote: "" | '"' | "`" = "";
    if (path[i] === '"' || path[i] === "`") {
      quote = path[i] as '"' | "`";
      i = readQuoted(path, i);
      if (i < 0) return null;
      name = path.slice(start + 1, i - 1);
    } else {
      while (i < path.length && path[i] !== "." && path[i] !== "[") i++;
      name = path.slice(start, i);
      if (!name) return null;
    }
    steps.push({ kind: "member", raw: path.slice(start, i), name, quote });

    while (path[i] === "[") {
      const open = i;
      i++;
      while (i < path.length && path[i] !== "]") {
        if (path[i] === "'" || path[i] === '"') {
          i = readQuoted(path, i);
          if (i < 0) return null;
        } else {
          i++;
        }
      }
      if (path[i] !== "]") return null;
      i++;
      steps.push({
        kind: "subscript",
        raw: path.slice(open, i),
        inner: path.slice(open + 1, i - 1),
      });
    }

    if (i === path.length) return steps;
    if (path[i] !== ".") return null;
    i++;
  }
  return null;
}

// `$.` + the path for engines that take JSONPath in a string literal, with
// bare keys that aren't plain quoted as `."x y"` or `["x y"]`. The result
// still has to be escaped as a SQL string literal.
export function quoteJsonPath(path: string, style: "dot" | "bracket"): string {
  const steps = parseJsonPath(path);
  if (!steps) return `$.${path}`;
  return (
    "$" +
    steps
      .map((step) => {
        if (step.kind === "subscript") return step.raw;
        if (step.quote || BARE_MEMBER.test(step.raw)) return `.${step.raw}`;
        const quoted = JSON.stringify(step.name);
        return style === "dot" ? `.${quoted}` : `[${quoted}]`;
      })
      .join("")
  );
}
