export function ensure<T>(x: T): asserts x is NonNullable<T> {
  if (x === undefined || x === null) {
    throw new TypeError("Internal error value should not be undefined");
  }
}
