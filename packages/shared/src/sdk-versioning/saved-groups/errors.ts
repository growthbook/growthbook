/**
 * Markers we put in place of a saved group reference we cannot resolve.
 * Each one is an operator no SDK knows, so it matches nobody. A broken
 * reference fails closed instead of letting everyone through.
 */
export const SAVED_GROUP_ERROR_MAX_DEPTH = "__sgMaxDepth__";
export const SAVED_GROUP_ERROR_CYCLE = "__sgCycle__";
export const SAVED_GROUP_ERROR_INVALID = "__sgInvalid__";
export const SAVED_GROUP_ERROR_UNKNOWN = "__sgUnknown__";

// How deep we follow a chain of groups that reference other groups.
export const MAX_SAVED_GROUP_DEPTH = 10;

const SAVED_GROUP_ERROR_MESSAGES: Record<string, (groupId: string) => string> =
  {
    [SAVED_GROUP_ERROR_INVALID]: (groupId) =>
      `Saved Group "${groupId}" has no attribute key or an invalid condition`,
    [SAVED_GROUP_ERROR_UNKNOWN]: (groupId) =>
      `Saved Group "${groupId}" does not exist`,
    [SAVED_GROUP_ERROR_MAX_DEPTH]: () =>
      `Saved Groups are nested more than ${MAX_SAVED_GROUP_DEPTH} levels deep`,
    [SAVED_GROUP_ERROR_CYCLE]: (groupId) =>
      `Saved Group "${groupId}" is nested inside itself`,
  };

/**
 * Why a condition with error markers cannot be used, naming the first Saved
 * Group at fault. Null when it has none.
 */
export function describeSavedGroupError(
  condition: unknown,
  ignoreCycleErrors: boolean = false,
): string | null {
  if (!condition) return null;

  const src =
    typeof condition === "object"
      ? JSON.stringify(condition)
      : String(condition);

  const errorMarkers = ignoreCycleErrors
    ? [SAVED_GROUP_ERROR_INVALID]
    : Object.keys(SAVED_GROUP_ERROR_MESSAGES);

  const match = src.match(
    new RegExp(
      `"(${errorMarkers.join("|")})"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")?`,
    ),
  );
  if (!match) return null;
  return SAVED_GROUP_ERROR_MESSAGES[match[1]](
    match[2] ? JSON.parse(match[2]) : "",
  );
}

/** True if a condition contains any of the error markers. */
export function conditionHasSavedGroupErrors(
  condition: unknown,
  ignoreCycleErrors: boolean = false,
) {
  return describeSavedGroupError(condition, ignoreCycleErrors) !== null;
}
