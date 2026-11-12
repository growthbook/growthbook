import isEqual from "lodash/isEqual";
import { evalCondition, type ConditionInterface } from "@growthbook/growthbook";
import type { ExperimentPhase } from "shared/types/experiment";

// An expectation that can't be a literal: there is more than one correct way
// to write a condition, and an agent picks the namespace range itself.
export interface Matcher<T> {
  readonly describe: string;
  readonly test: (actual: T | undefined) => boolean;
}

export type Expected<T> = T | Matcher<T>;

function isMatcher(v: unknown): v is Matcher<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    "test" in v &&
    typeof v.test === "function"
  );
}

// Writes fill in defaults the seed left out, so a missing field, null, and an
// empty list all mean "nothing here". Floats are compared at 1e-6 so 0.7 and
// 0.7000000001 agree.
function normalize(v: unknown): unknown {
  if (v === null || (Array.isArray(v) && v.length === 0)) return undefined;
  if (typeof v === "number") return Math.round(v * 1e6) / 1e6;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .map(([k, x]) => [k, normalize(x)] as const)
        .filter(([, x]) => x !== undefined),
    );
  }
  return v;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return isEqual(normalize(a), normalize(b));
}

export function describeExpected(expected: unknown): string {
  return isMatcher(expected) ? expected.describe : JSON.stringify(expected);
}

export function matches(actual: unknown, expected: unknown): boolean {
  return isMatcher(expected)
    ? expected.test(actual)
    : sameValue(actual, expected);
}

type Attributes = Record<string, unknown>;

function parseCondition(
  condition: string | undefined,
): ConditionInterface | null {
  if (!condition || !condition.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(condition);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ConditionInterface)
      : null;
  } catch {
    return null;
  }
}

function* combinations(
  values: Record<string, unknown[]>,
): Generator<Attributes> {
  const keys = Object.keys(values);
  const walk = function* (i: number, acc: Attributes): Generator<Attributes> {
    if (i === keys.length) {
      yield acc;
      return;
    }
    for (const v of values[keys[i]]) {
      yield* walk(i + 1, v === undefined ? acc : { ...acc, [keys[i]]: v });
    }
  };
  yield* walk(0, {});
}

const OTHER_VALUE = "(some other value)";

// The scenario's samples plus every value either condition compares an
// attribute against. An attribute the samples leave out also gets a missing
// value and one neither condition names, so a condition can't widen the
// audience through it unseen.
function samplesFor(
  samples: Record<string, unknown[]>,
  conditions: unknown[],
): Record<string, unknown[]> {
  const values = new Map(
    Object.entries(samples).map(([k, v]) => [k, new Set(v)]),
  );
  const visit = (node: unknown, attribute: string | null): void => {
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, attribute));
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        visit(value, key.startsWith("$") ? attribute : key);
      }
    } else if (attribute !== null) {
      const set =
        values.get(attribute) ?? new Set<unknown>([undefined, OTHER_VALUE]);
      set.add(node);
      values.set(attribute, set);
    }
  };
  conditions.forEach((c) => visit(c, null));
  return Object.fromEntries([...values].map(([k, set]) => [k, [...set]]));
}

// Targets the same users as `expected` across every combination of the
// sample attribute values (undefined means the attribute is missing).
export function sameAudience(
  expected: ConditionInterface,
  samples: Record<string, unknown[]>,
): Matcher<string> {
  return {
    describe: `a condition that targets the same users as ${JSON.stringify(expected)}`,
    test: (actual) => {
      const parsed = parseCondition(actual);
      if (!parsed) return false;
      for (const attributes of combinations(
        samplesFor(samples, [parsed, expected]),
      )) {
        if (
          evalCondition(attributes, parsed) !==
          evalCondition(attributes, expected)
        ) {
          return false;
        }
      }
      return true;
    },
  };
}

export function weights(expected: number[], tolerance = 1e-3) {
  return {
    describe: `weights ${JSON.stringify(expected)}`,
    test: (actual: number[] | undefined) =>
      !!actual &&
      actual.length === expected.length &&
      actual.every((w, i) => Math.abs(w - expected[i]) <= tolerance),
  } satisfies Matcher<number[]>;
}

export function equalWeights(): Matcher<number[]> {
  return {
    describe: "equal weights",
    test: (actual) =>
      !!actual?.length &&
      actual.every((w) => Math.abs(w - 1 / actual.length) <= 1e-3),
  };
}

export function inNamespace(
  name: string,
): Matcher<ExperimentPhase["namespace"]> {
  return {
    describe: `enabled in namespace "${name}" with a non-empty range`,
    test: (actual) => {
      if (!actual?.enabled || actual.name !== name) return false;
      const ranges = "ranges" in actual ? actual.ranges : [actual.range];
      return ranges.some(([start, end]) => end > start);
    },
  };
}

export function oneOf<T>(...options: T[]): Matcher<T> {
  return {
    describe: `one of ${options.map((o) => JSON.stringify(o)).join(", ")}`,
    test: (actual) => options.some((o) => sameValue(actual, o)),
  };
}

export function present<T>(): Matcher<T> {
  return {
    describe: "any value",
    test: (actual) => actual !== undefined && actual !== null,
  };
}
