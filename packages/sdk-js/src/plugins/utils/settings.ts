function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function mergeTwo<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (value === undefined) continue;
    const existing = result[key];
    // Plain objects merge recursively; arrays, functions, and primitives
    // replace, so a layer can fully override a list.
    result[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? mergeTwo(existing, value)
        : value;
  }
  return result as T;
}

// Layered plugin settings: defaults, then each override layer in order.
// undefined values in a layer never clobber earlier layers.
export function mergeSettings<T extends Record<string, unknown>>(
  defaults: T,
  ...layers: Array<Record<string, unknown> | undefined>
): T {
  let result = defaults;
  for (const layer of layers) {
    if (layer) result = mergeTwo(result, layer);
  }
  return result;
}
