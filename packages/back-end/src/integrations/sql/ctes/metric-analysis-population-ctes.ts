import type { DataSourceInterface } from "shared/types/datasource";
import type { MetricAnalysisSettings } from "shared/types/metric-analysis";
import type { SegmentInterface } from "shared/types/segment";
import type { SqlDialect } from "shared/types/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { getSegmentCTE } from "back-end/src/integrations/sql/ctes/segment-cte";

export function getMetricAnalysisPopulationCTEs(
  dialect: SqlDialect,
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
        ${compileSqlTemplate(
          exposureQuery.query,
          {
            startDate: settings.startDate,
            endDate: settings.endDate ?? undefined,
          },
          dialect,
        )}
      ),
      __population AS (
        -- All recent users
        SELECT DISTINCT
          ${settings.userIdType}
        FROM
            __rawExperiment
        WHERE
            timestamp >= ${dialect.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND timestamp <= ${dialect.toTimestamp(settings.endDate)}`
                : ""
            }
        ),`;
  }

  if (settings.populationType === "segment" && segment) {
    // TODO segment missing
    return `
      __segment as (${getSegmentCTE(
        dialect,
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
            date >= ${dialect.toTimestamp(settings.startDate)}
            ${
              settings.endDate
                ? `AND date <= ${dialect.toTimestamp(settings.endDate)}`
                : ""
            }
      ),`;
  }

  return "";
}
