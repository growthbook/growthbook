// Shared helpers for the named-type language converters (TypeScript, Protobuf,
// Python, Go, Rust). Kept in one place so every converter escapes JSON-Pointers,
// generates fallback type names, and detects integers identically.

// RFC6901: escape `~` and `/` so a field key is safe inside a JSON-Pointer
// segment. Capture and render must agree, so both sides call this.
export function jsonPointerEscape(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// A PascalCase type name generated from a field key, for when a projection
// doesn't supply one (e.g. `http_config` -> `HttpConfig`). Falls back to
// `Nested` for keys with no alphanumerics.
export function pascalCaseTypeName(key: string): string {
  return (
    key
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Nested"
  );
}

// Whether a JSON Schema node is an integer. Integers ride the pivot either as
// `{type:"integer"}` or as `{type:"number", multipleOf:1}` / `format:"number"`
// (how `simpleSchemaFieldToJSONSchema` emits them), so a renderer that wants
// `int`/`i64`/`int32` vs a float must check both forms.
export function isIntegerSchemaNode(
  node: Record<string, unknown>,
  type: string | undefined,
): boolean {
  if (type === "integer") return true;
  return (
    type === "number" && (node.multipleOf === 1 || node.format === "number")
  );
}
