import stringify from "json-stringify-pretty-compact";

const MAX_LINE = 80;

// Spaces inside a one-line object's braces, `{ "a": 1 }`, as written by hand.
function padInlineBraces(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "}" && !/[\s{]/.test(json[i - 1] ?? "")) {
      out += " ";
    }
    out += c;
    if (!inString && c === "{" && !/[\s}]/.test(json[i + 1] ?? "")) {
      out += " ";
    }
  }
  return out;
}

function compact(value: unknown, maxLength: number): string {
  // Two characters short, for the padding.
  return padInlineBraces(stringify(value, { maxLength: maxLength - 2 }));
}

// A JSON value as people read it: what fits on a line stays on one ("{ "a": 1 }",
// "["a", "b"]"), anything longer breaks. With `keysOnOwnLines`, an object's
// top-level keys each start a line, so a highlight can mark one key's lines
// without catching its neighbors'; what's inside them still compacts.
export function formatJsonValue(
  value: unknown,
  { keysOnOwnLines = false }: { keysOnOwnLines?: boolean } = {},
): string {
  if (
    !keysOnOwnLines ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    return compact(value, MAX_LINE);
  }
  const entries = Object.entries(value).map(([key, v]) => {
    const prefix = `  ${JSON.stringify(key)}: `;
    const formatted = compact(v, Math.max(MAX_LINE - prefix.length, 2));
    return prefix + formatted.split("\n").join("\n  ");
  });
  return `{\n${entries.join(",\n")}\n}`;
}

// 1-based, inclusive line range of each top-level field in a JSON object's
// text, however it's formatted. Empty when the text isn't an object.
export function getTopLevelFieldLines(
  json: string,
): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>();
  if (json.trimStart()[0] !== "{") return ranges;

  let line = 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = 0;
  let expectingKey = false;
  let pendingKey: { key: string; line: number } | null = null;
  let open: { key: string; start: number } | null = null;
  let lastContentLine = 1;

  const close = (end: number) => {
    if (open) ranges.set(open.key, { start: open.start, end });
    open = null;
  };

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (c === "\n") {
      line++;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        inString = false;
        if (depth === 1 && expectingKey) {
          try {
            pendingKey = {
              key: JSON.parse(json.slice(stringStart, i + 1)),
              line,
            };
          } catch {
            pendingKey = null;
          }
        }
      }
      lastContentLine = line;
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) expectingKey = true;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) close(lastContentLine);
    } else if (c === ":" && depth === 1 && pendingKey) {
      open = { key: pendingKey.key, start: pendingKey.line };
      pendingKey = null;
      expectingKey = false;
    } else if (c === "," && depth === 1) {
      close(line);
      expectingKey = true;
    }
    if (c.trim()) lastContentLine = line;
  }
  return ranges;
}

// 1-based line numbers of the given top-level fields' entries.
export function getFieldLineNumbers(
  json: string,
  fields: Set<string>,
): number[] {
  const lines: number[] = [];
  getTopLevelFieldLines(json).forEach(({ start, end }, key) => {
    if (!fields.has(key)) return;
    for (let l = start; l <= end; l++) lines.push(l);
  });
  return lines;
}
