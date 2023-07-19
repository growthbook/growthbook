/**
 * A test helper that will recursively freeze an object using Object.freeze
 * In strict mode, which is enabled during test runs, attempting to mutate a frozen object
 * will result in a runtime exception and cause the test to fail.
 * Ref: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
 * @param object
 */
export function deepFreeze(object: Record<string, unknown> | Array<unknown>) {
  // Retrieve the property names defined on object
  const propNames = Reflect.ownKeys(object);

  // Freeze properties before freezing self
  for (const name of propNames) {
    const value = object[name];

    if ((value && typeof value === "object") || typeof value === "function") {
      deepFreeze(value);
    }
  }

  return Object.freeze(object);
}
