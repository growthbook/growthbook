// Runs writes one at a time in call order, so a slower older write can never
// land after a newer one. A failed write does not block the ones after it.
export function createOrderedWriter() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(write: () => Promise<T>): Promise<T> => {
    const result = tail.then(write);
    tail = result.catch(() => undefined);
    return result;
  };
}
