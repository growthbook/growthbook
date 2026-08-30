import { getDelayWindowHours, getMetricWindowHours } from "shared/experiments";
import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { addHours } from "back-end/src/integrations/sql/primitives/add-hours";
import { castToTimestamp } from "back-end/src/integrations/sql/primitives/cast-to-timestamp";

export function computeParticipationDenominator(
  dialect: SqlDialect,
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
    startDateString = addHours(dialect, startDateString, delayHours);
  }

  let endDateString = castToTimestamp(dialect.toTimestamp(analysisEndDate));

  if (metric.windowSettings.type === "lookback") {
    const lookbackStartDate = new Date(analysisEndDate);
    lookbackStartDate.setHours(lookbackStartDate.getHours() - windowHours);
    startDateString = `GREATEST(${startDateString}, ${castToTimestamp(dialect.toTimestamp(lookbackStartDate))})`;
  } else if (
    metric.windowSettings.type === "conversion" &&
    !overrideConversionWindows
  ) {
    endDateString = `LEAST(${dialect.getCurrentTimestamp()}, ${addHours(dialect, startDateString, windowHours)})`;
  }

  return dialect.castToFloat(
    `GREATEST(${dialect.dateDiff(startDateString, endDateString)} + 1, 1)`,
  );
}
