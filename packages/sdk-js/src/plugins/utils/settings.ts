function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function mergeTwo<T extends object>(base: T, override: object): T {
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const key of Object.keys(override)) {
    const value = (override as Record<string, unknown>)[key];
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
export function mergeSettings<T extends object>(
  defaults: T,
  ...layers: Array<object | undefined>
): T {
  let result = defaults;
  for (const layer of layers) {
    if (layer) result = mergeTwo(result, layer);
  }
  return result;
}
