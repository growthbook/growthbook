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
