import type { z } from "zod";

/**
 * Paths in a zod schema whose name says they may hold a feature id. The path
 * grammar matches the rename registry: `[]` walks array items, `{}` walks
 * record values and `{key}` means the record keys themselves.
 */
export function featureIdShapedPaths(schema: z.ZodType): string[] {
  const found = new Set<string>();
  walk(schema, [], found, new Set());
  return [...found].sort();
}

export const FEATURE_ID_KEY =
  /^(feature|features|featureId|featureIds|featureKey|featureKeys|flagKey|linkedFeatures|parentId|entityId|prerequisites)$/;

type Def = {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  left?: z.ZodType;
  right?: z.ZodType;
  getter?: () => z.ZodType;
};

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

function walk(
  schema: z.ZodType,
  path: string[],
  found: Set<string>,
  seen: Set<z.ZodType>,
) {
  if (seen.has(schema)) return;
  const def = defOf(schema);
  const inner = (next: z.ZodType | undefined, nextPath = path) => {
    if (!next) return;
    seen.add(schema);
    walk(next, nextPath, found, seen);
    seen.delete(schema);
  };
  switch (def.type) {
    case "object":
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        const childPath = [...path, key];
        if (FEATURE_ID_KEY.test(key)) found.add(childPath.join("."));
        inner(child, childPath);
      }
      return;
    case "array":
      return inner(def.element, [...path, "[]"]);
    case "record":
      if (FEATURE_ID_KEY.test(path[path.length - 1] ?? "")) {
        found.add([...path, "{key}"].join("."));
      }
      return inner(def.valueType, [...path, "{}"]);
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
      return inner(def.innerType);
    case "union":
      return (def.options ?? []).forEach((option) => inner(option));
    case "intersection":
      inner(def.left);
      return inner(def.right);
    case "pipe":
      inner(def.in);
      return inner(def.out);
    case "lazy":
      return inner(def.getter?.());
    default:
      return;
  }
}
