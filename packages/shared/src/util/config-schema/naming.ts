// RFC6901: escape `~` and `/` so a field key is safe inside a JSON-Pointer segment.
export function jsonPointerEscape(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// Fallback PascalCase type name when a projection doesn't supply one.
export function pascalCaseTypeName(key: string): string {
  return (
    key
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join("") || "Nested"
  );
}

// Integers ride the pivot as `{type:"integer"}` or `{type:"number", multipleOf:1}`/
// `format:"number"`, so renderers wanting int vs float must check both forms.
export function isIntegerSchemaNode(
  node: Record<string, unknown>,
  type: string | undefined,
): boolean {
  if (type === "integer") return true;
  return (
    type === "number" && (node.multipleOf === 1 || node.format === "number")
  );
}
