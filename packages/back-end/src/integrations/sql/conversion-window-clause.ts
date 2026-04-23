import {
  ExperimentMetricInterface,
  getDelayWindowHours,
  getMetricWindowHours,
} from "shared/experiments";
import type { SqlHelpers } from "shared/types/sql";

import { addHours } from "./add-hours";

export function getConversionWindowClause(
  helpers: SqlHelpers,
  baseCol: string,
  metricCol: string,
  metric: ExperimentMetricInterface,
  endDate: Date,
  overrideConversionWindows: boolean,
): string {
  let windowHours = getMetricWindowHours(metric.windowSettings);
  const delayHours = getDelayWindowHours(metric.windowSettings);

  // all metrics have to be after the base timestamp +- delay hours
  let metricWindow = `${metricCol} >= ${addHours(helpers, baseCol, delayHours)}`;

  if (
    metric.windowSettings.type === "conversion" &&
    !overrideConversionWindows
  ) {
    // if conversion window, then count metrics before window ends
    // which can extend beyond experiment end date
    metricWindow = `${metricWindow}
        AND ${metricCol} <= ${addHours(
          helpers,
          baseCol,
          delayHours + windowHours,
        )}`;
  } else {
    // otherwise, it must be before the experiment end date
    metricWindow = `${metricWindow}
      AND ${metricCol} <= ${helpers.toTimestamp(endDate)}`;
  }

  if (metric.windowSettings.type === "lookback") {
    // ensure windowHours is positive
    windowHours = windowHours < 0 ? windowHours * -1 : windowHours;
    // also ensure for lookback windows that metric happened in last
    // X hours of the experiment
    metricWindow = `${metricWindow}
      AND ${addHours(helpers, metricCol, windowHours)} >= ${helpers.toTimestamp(
        endDate,
      )}`;
  }

  return metricWindow;
}
