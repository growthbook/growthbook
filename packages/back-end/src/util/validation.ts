import { SafeParseReturnType } from "zod";

/**
 * Given a Zod SafeParseReturnType (result from running safeParse())
 * will return either null (if no error) or an error string
 * formatted like: [event_id] Required, [event] Required, [object] Required.
 * @param safeParseResult
 * @returns null | string
 */
export const errorStringFromZodResult = (
  safeParseResult: SafeParseReturnType<unknown, unknown>
): string | null => {
  if (safeParseResult.success) {
    return null;
  }

  const errors = safeParseResult.error.issues.map((i) => {
    return "[" + i.path.join(".") + "] " + i.message;
  });
  return errors.join(", ");
};
