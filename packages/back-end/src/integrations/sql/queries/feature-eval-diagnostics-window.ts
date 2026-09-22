import { subDays, subHours, subMinutes } from "date-fns";
import type {
  FeatureEvalDiagnosticsQueryParams,
  FeatureEvalDiagnosticsWindow,
} from "shared/types/integrations";

/** Historical behaviour, kept exactly when a caller passes neither field. */
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_LIMIT = 100;

/**
 * One definition of what a diagnostics lookback means, shared by the managed
 * warehouse and generic SQL builders. Without it the two would drift, and the
 * table would describe a different period depending on the data source.
 */
export function resolveFeatureEvalDiagnosticsWindow(
  params: FeatureEvalDiagnosticsQueryParams,
  now: Date = new Date(),
): FeatureEvalDiagnosticsWindow {
  const limit = params.limit ?? DEFAULT_LIMIT;

  switch (params.lookback) {
    case "15minute":
      return { start: subMinutes(now, 15), limit };
    case "hour":
      return { start: subHours(now, 1), limit };
    case "day":
      return { start: subDays(now, 1), limit };
    case "week":
      return { start: subDays(now, 7), limit };
    case undefined:
    default:
      // No lookback asked for: the historical 7-day window, unchanged.
      return { start: subDays(now, DEFAULT_LOOKBACK_DAYS), limit };
  }
}
