import type { PopulationDataQuerySettings } from "shared/types/query";
import { SegmentInterface } from "shared/types/segment";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";

import { getSegmentCTE } from "back-end/src/integrations/sql/ctes/segment-cte";

export function getPowerPopulationSourceCTE(
  dialect: SqlDialect,
  {
    settings,
    factTableMap,
    segment,
  }: {
    settings: PopulationDataQuerySettings;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  },
): string {
  switch (settings.sourceType) {
    case "segment": {
      if (segment) {
        const factTable = segment.factTableId
          ? factTableMap.get(segment.factTableId)
          : undefined;
        return `
          __source AS (${getSegmentCTE(
            dialect,
            segment,
            settings.userIdType,
            {}, // no id join map needed as id type is segment id type
            factTableMap,
            {
              startDate: settings.startDate,
              endDate: settings.endDate ?? undefined,
              templateVariables: { eventName: factTable?.eventName },
            },
          )})`;
      } else {
        throw new Error("Segment not found");
      }
    }
    case "factTable": {
      const factTable = factTableMap.get(settings.sourceId);
      if (factTable) {
        const sql = factTable.sql;
        return compileSqlTemplate(
          `
          __source AS (
            SELECT
              ${settings.userIdType}
              , timestamp
            FROM (
              ${sql}
            ) ft
          )`,
          {
            startDate: settings.startDate,
            endDate: settings.endDate ?? undefined,
            templateVariables: { eventName: factTable.eventName },
          },
          dialect,
        );
      } else {
        throw new Error("Fact Table not found");
      }
    }
  }
}
