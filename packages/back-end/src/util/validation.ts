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
