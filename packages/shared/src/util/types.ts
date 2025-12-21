/* eslint-disable @typescript-eslint/no-explicit-any */

// Check if two types are equal
export type IfEqual<U, V, True, False = never> = [U] extends [V]
  ? [V] extends [U]
    ? True
    : False
  : False;

export type IsTuple<Tuple extends any[]> = {
  empty: true;
  nonEmpty: ((...p: Tuple) => any) extends (
    p1: infer First,
    ...p: infer Rest
  ) => any
    ? IsTuple<Rest>
    : false;
  infinite: false;
}[Tuple extends []
  ? "empty"
  : Tuple extends (infer Element)[]
    ? Element[] extends Tuple
      ? "infinite"
      : "nonEmpty"
    : never];

export type TupleToUnion<T> = T extends (infer E)[] ? E : never;

export type UnionPop<U> = (
  (U extends any ? (k: (x: U) => void) => void : never) extends (
    k: infer I,
  ) => void
    ? I
    : never
) extends { (a: infer A): void }
  ? A
  : never;

export type TuplePrepend<T extends any[], E> = ((
  a: E,
  ...r: T
) => void) extends (...r: infer R) => void
  ? R
  : never;

type UnionToTupleRecursively<Union, Result extends any[]> = {
  1: Result;
  0: UnionToTupleRecursively<
    Exclude<Union, UnionPop<Union>>,
    TuplePrepend<Result, UnionPop<Union>>
  >;
}[[Union] extends [never] ? 1 : 0];

export type UnionToTuple<U> = UnionToTupleRecursively<U, []>;

export function ensure<T>(x: T): asserts x is NonNullable<T> {
  if (x === undefined || x === null) {
    throw new TypeError("Internal error value should not be undefined");
  }
}

export function ensureAndReturn<T>(x: T): NonNullable<T> {
  ensure(x);
  return x;
}

// The built-in Omit<> doesn't work for certain composites like discriminated unions
export type DistributiveOmit<T, K extends PropertyKey> = T extends any
  ? Omit<T, K>
  : never;

export function isStringArray(data: unknown): data is Array<string> {
  return Array.isArray(data) && !data.find((el) => typeof el !== "string");
}

export function isString(data: unknown): data is string {
  return typeof data === "string";
}

export function isNumber(data: unknown): data is number {
  return typeof data === "number";
}

/**
 * Helper function to ensure all union type values are present in an array.
 * Useful for creating exhaustive label mappings for union types.
 *
 * @example
 * type Color = "red" | "green" | "blue";
 * const colorLabels = ensureAllUnionValues<Color>()([
 *   { value: "red", label: "Red" },
 *   { value: "green", label: "Green" },
 *   { value: "blue", label: "Blue" },
 * ]);
 */
export function ensureValuesExactlyMatchUnion<UnionType extends string>() {
  return <const T extends ReadonlyArray<{ value: UnionType; label: string }>>(
    labels: T &
      (Exclude<UnionType, T[number]["value"]> extends never
        ? T
        : `Missing value: ${Exclude<UnionType, T[number]["value"]>}`),
  ): Array<T[number]> => {
    return [...labels];
  };
}
