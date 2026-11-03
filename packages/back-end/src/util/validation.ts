import { ZodSafeParseError } from "zod";
import { BadRequestError } from "back-end/src/util/errors";

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

// Only for routes whose front-end callers chunk their requests to fit under it.
export const MAX_IDS_QUERY_LENGTH = 500;

/**
 * Parses a comma-separated `ids` query param into a list of ids.
 * Returns undefined when the param is absent or empty, and throws a 400 if
 * it isn't a single string (e.g. `?ids=a&ids=b`) or has more than `max` ids.
 */
export function parseIdsQuery(
  ids: unknown,
  { max = Infinity }: { max?: number } = {},
): string[] | undefined {
  if (ids === undefined || ids === "") return undefined;
  if (typeof ids !== "string") {
    throw new BadRequestError("ids must be a comma-separated string");
  }
  const list = ids
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (list.length > max) {
    throw new BadRequestError(`ids cannot contain more than ${max} values`);
  }
  return list;
}

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
  } else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    index = Number(value);
  } else {
    return undefined;
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    return undefined;
  }
  return index;
}
