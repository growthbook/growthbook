// Format a parsed JSON value for display/storage with one design rule:
// **objects always go one key per line** (never collapsed onto a single line),
// while **arrays stay inline when they're short and hold only primitives**.
// An array that contains an object (or that's too long) expands one element per
// line so the nested objects keep their one-key-per-line formatting.
//
// This is the formatter for feature flag JSON values (the editor's "Format"
// action and the constant-`$extends` insertion), so short config objects read
// vertically while compact lists like `["@const:a", "@const:b"]` stay tidy.

// Max characters an inlined array may occupy (including its own indentation)
// before it's expanded onto multiple lines.
const MAX_INLINE_ARRAY_LENGTH = 80;

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

// `JSON.stringify` returns the JS value `undefined` (not a string) for
// `undefined`, functions, and symbols. Interpolating that into the output would
// emit literal `undefined` (invalid JSON), so coerce to `"null"` — matching how
// `JSON.stringify` renders these inside arrays.
function stringifyPrimitive(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function format(value: unknown, indent: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    // Inline only when every element is a primitive and the result fits.
    if (value.every(isPrimitive)) {
      const inline = `[${value.map(stringifyPrimitive).join(", ")}]`;
      if (indent + inline.length <= MAX_INLINE_ARRAY_LENGTH) return inline;
    }
    const childPad = " ".repeat(indent + 2);
    const items = value.map((v) => childPad + format(v, indent + 2));
    return `[\n${items.join(",\n")}\n${" ".repeat(indent)}]`;
  }

  if (value !== null && typeof value === "object") {
    // Skip keys whose value can't serialize (undefined/function/symbol), exactly
    // as `JSON.stringify` drops them — so a salvaged object never emits
    // `"key": undefined`.
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) =>
        v !== undefined && typeof v !== "function" && typeof v !== "symbol",
    );
    if (entries.length === 0) return "{}";
    const childPad = " ".repeat(indent + 2);
    const items = entries.map(
      ([k, v]) => `${childPad}${JSON.stringify(k)}: ${format(v, indent + 2)}`,
    );
    return `{\n${items.join(",\n")}\n${" ".repeat(indent)}}`;
  }

  return stringifyPrimitive(value);
}

// Serialize `value` with objects expanded one key per line and short
// primitive-only arrays kept inline. Returns a string with no trailing newline.
export function formatJsonMultilineObjects(value: unknown): string {
  return format(value, 0);
}
