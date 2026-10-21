import { ZodSafeParseError } from "zod";

/**
 * Given a Zod SafeParseError, will return an error string
 * formatted like: [event_id] Required, [event] Required, [object] Required.
 * @param safeParseResult
 * @returns null | string
 */
export const errorStringFromZodResult = (
  safeParseResult: ZodSafeParseError<unknown>,
): string =>
  safeParseResult.error.issues
    .map((i) => "[" + i.path.join(".") + "] " + i.message)
    .join(", ");

/**
 * Parses an untrusted value (e.g. a route param or request body field) into a
 * valid index for an array of the given length. Returns undefined unless the
 * value is a non-negative integer (or its canonical decimal string) that is
 * within bounds.
 *
 * Use this instead of indexing with the raw value: strings such as
 * "__proto__" or "constructor" resolve to truthy inherited properties on
 * arrays, which defeats `if (!arr[i])` existence checks and can lead to
 * prototype pollution on assignment.
 */
export function parseArrayIndex(
  value: unknown,
  length: number,
): number | undefined {
  let index: number;
  if (typeof value === "number") {
    index = value;
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    index = Number(value);
  } else {
    return undefined;
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    return undefined;
  }
  return index;
}
