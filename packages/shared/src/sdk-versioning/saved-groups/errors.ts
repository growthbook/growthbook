/**
 * Markers we put in place of a saved group reference we cannot resolve.
 * Each one is an operator no SDK knows, so it matches nobody. A broken
 * reference fails closed instead of letting everyone through.
 */
export const SAVED_GROUP_ERROR_MAX_DEPTH = "__sgMaxDepth__";
export const SAVED_GROUP_ERROR_CYCLE = "__sgCycle__";
export const SAVED_GROUP_ERROR_INVALID = "__sgInvalid__";
export const SAVED_GROUP_ERROR_UNKNOWN = "__sgUnknown__";

/** True if a condition contains any of the error markers. */
export function conditionHasSavedGroupErrors(
  condition: unknown,
  ignoreCycleErrors: boolean = false,
) {
  if (!condition) return false;

  const src =
    typeof condition === "object"
      ? JSON.stringify(condition)
      : String(condition);

  const errorMarkers = [
    SAVED_GROUP_ERROR_INVALID,
    ...(ignoreCycleErrors
      ? []
      : [
          SAVED_GROUP_ERROR_UNKNOWN,
          SAVED_GROUP_ERROR_MAX_DEPTH,
          SAVED_GROUP_ERROR_CYCLE,
        ]),
  ];

  if (errorMarkers.length === 0) return false;

  const regex = new RegExp(`"(${errorMarkers.join("|")})"\\s*:`);
  return !!src.match(regex);
}
