// JSON field names come from sampled warehouse rows, so only plain keys
// (optionally followed by array steps like `items[0]`) are written into a
// JSON path as-is. Everything else gets quoted.
const PLAIN_JSON_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARRAY_STEPS = /(\[\d+\])*$/;

export function splitJsonPath(
  path: string,
): { key: string; arraySteps: string }[] {
  return path.split(".").map((segment) => {
    const arraySteps = segment.match(ARRAY_STEPS)?.[0] ?? "";
    return {
      key: segment.slice(0, segment.length - arraySteps.length),
      arraySteps,
    };
  });
}

export function isPlainJsonPath(path: string): boolean {
  return splitJsonPath(path).every(({ key }) => PLAIN_JSON_KEY.test(key));
}

// `$.a.b[0]`, with any other key quoted as `."x y"` or `["x y"]`.
export function quoteJsonPath(path: string, style: "dot" | "bracket"): string {
  return (
    "$" +
    splitJsonPath(path)
      .map(({ key, arraySteps }) => {
        if (PLAIN_JSON_KEY.test(key)) return `.${key}${arraySteps}`;
        const quoted = JSON.stringify(key);
        return `${style === "dot" ? `.${quoted}` : `[${quoted}]`}${arraySteps}`;
      })
      .join("")
  );
}
