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
