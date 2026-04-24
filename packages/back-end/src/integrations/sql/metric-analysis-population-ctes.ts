import type { DataSourceInterface } from "shared/types/datasource";
import type { MetricAnalysisSettings } from "shared/types/metric-analysis";
import type { SegmentInterface } from "shared/types/segment";
import type { SqlHelpers } from "shared/types/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getExposureQuery } from "./exposure-query";
import { getSegmentCTE } from "./segment-cte";

export function getMetricAnalysisPopulationCTEs(
  helpers: SqlHelpers,
  {
    datasource,
    settings,
    idJoinMap,
    factTableMap,
    segment,
  }: {
    datasource: DataSourceInterface;
    settings: MetricAnalysisSettings;
    idJoinMap: Record<string, string>;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  },
): string {
  if (settings.populationType === "exposureQuery") {
    const exposureQuery = getExposureQuery(
      datasource,
      settings.populationId || "",
    );

    return `
      __rawExperiment AS (
        ${compileSqlTemplate(exposureQuery.query, {
          startDate: settings.startDate,
          endDate: settings.endDate ?? undefined,
        })}
      ),
      __population AS (
        -- All recent users
        SELECT DISTINCT
          ${settings.userIdType}
        FROM
            __rawExperiment
        WHERE
            timestamp >= ${helpers.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND timestamp <= ${helpers.toTimestamp(settings.endDate)}`
                : ""
            }
        ),`;
  }

  if (settings.populationType === "segment" && segment) {
    // TODO segment missing
    return `
      __segment as (${getSegmentCTE(
        helpers,
        segment,
        settings.userIdType,
        idJoinMap,
        factTableMap,
        {
          startDate: settings.startDate,
          endDate: settings.endDate ?? undefined,
        },
      )}),
      __population AS (
        SELECT DISTINCT
          ${settings.userIdType}
        FROM
          __segment e
        WHERE
            date >= ${helpers.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND date <= ${helpers.toTimestamp(settings.endDate)}`
                : ""
            }
      ),`;
  }

  return "";
}
