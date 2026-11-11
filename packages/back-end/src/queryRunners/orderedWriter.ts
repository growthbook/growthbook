// Runs writes one at a time in call order, so a slower older write can never
// land after a newer one. A failed write does not block the ones after it.
export function createOrderedWriter() {
  let tail: Promise<unknown> = Promise.resolve();
  const write = <T>(run: () => Promise<T>): Promise<T> => {
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
  // Settles once every write queued so far, and any queued meanwhile, has.
  const flush = async () => {
    let current: Promise<unknown>;
    do {
      current = tail;
      await current;
    } while (current !== tail);
  };
  return Object.assign(write, { flush });
}

export type OrderedWriter = ReturnType<typeof createOrderedWriter>;
