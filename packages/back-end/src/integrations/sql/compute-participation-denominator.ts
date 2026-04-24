import { getDelayWindowHours, getMetricWindowHours } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlHelpers } from "shared/types/sql";

import { addHours } from "./add-hours";
import { castToTimestamp } from "./cast-to-timestamp";

export function computeParticipationDenominator(
  helpers: SqlHelpers,
  {
    initialTimestampColumn,
    analysisEndDate,
    metric,
    overrideConversionWindows,
  }: {
    initialTimestampColumn: string;
    analysisEndDate: Date;
    metric: FactMetricInterface;
    overrideConversionWindows: boolean;
  },
): string {
  const delayHours = getDelayWindowHours(metric.windowSettings);
  const windowHours = getMetricWindowHours(metric.windowSettings);

  let startDateString = castToTimestamp(initialTimestampColumn);
  if (delayHours > 0) {
    startDateString = addHours(helpers, startDateString, delayHours);
  }

  let endDateString = castToTimestamp(helpers.toTimestamp(analysisEndDate));

  if (metric.windowSettings.type === "lookback") {
    const lookbackStartDate = new Date(analysisEndDate);
    lookbackStartDate.setHours(lookbackStartDate.getHours() - windowHours);
    startDateString = `GREATEST(${startDateString}, ${castToTimestamp(helpers.toTimestamp(lookbackStartDate))})`;
  } else if (
    metric.windowSettings.type === "conversion" &&
    !overrideConversionWindows
  ) {
    endDateString = `LEAST(${helpers.getCurrentTimestamp()}, ${addHours(helpers, startDateString, windowHours)})`;
  }

  return helpers.castToFloat(
    `GREATEST(${helpers.dateDiff(startDateString, endDateString)} + 1, 1)`,
  );
}
