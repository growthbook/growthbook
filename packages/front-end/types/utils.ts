export function ensure<T>(x: T): asserts x is NonNullable<T> {
  if (x === undefined || x === null) {
    throw new TypeError("Internal error value should not be undefined");
  }
}

export function ensureAndReturn<T>(x: T): NonNullable<T> {
  ensure(x);
  return x;
}

// Accept any partial value for Key = Type and require a full value otherwise
export type PartialOn<
  O extends object,
  Key extends keyof O,
  Type extends O[Key],
> =
  | ({
      [k in Key]: Extract<O[k], Type>;
    } & Partial<Omit<O, Key>>)
  | ({
      [k in Key]: Exclude<O[k], Type>;
    } & Omit<O, Key>);
