import type { DataSourceSettings } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import { getBaseIdTypeAndJoins } from "back-end/src/util/sql";

import { getIdentitiesQuery } from "back-end/src/integrations/sql/queries/identities-query";

export function getIdentitiesCTE(
  dialect: SqlDialect,
  settings: DataSourceSettings,
  {
    objects,
    from,
    to,
    forcedBaseIdType,
    experimentId,
    tableNamePrefix = "__identities_",
  }: {
    objects: string[][];
    from: Date;
    to?: Date;
    forcedBaseIdType?: string;
    experimentId?: string;
    tableNamePrefix?: string;
  },
): {
  baseIdType: string;
  idJoinSQL: string;
  idJoinMap: Record<string, string>;
} {
  const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
    objects,
    forcedBaseIdType,
  );

  // Joins for when an object doesn't support the baseIdType
  const joins: string[] = [];
  const idJoinMap: Record<string, string> = {};

  // Generate table names and SQL for each of the required joins
  joinsRequired.forEach((idType) => {
    const table = `${tableNamePrefix}${idType.replace(/[^a-zA-Z0-9_]/g, "")}`;
    idJoinMap[idType] = table;
    joins.push(
      `${table} as (
        ${getIdentitiesQuery(
          dialect,
          settings,
          baseIdType,
          idType,
          from,
          to,
          experimentId,
        )}
      ),`,
    );
  });

  return {
    baseIdType,
    idJoinSQL: joins.join("\n"),
    idJoinMap,
  };
}
