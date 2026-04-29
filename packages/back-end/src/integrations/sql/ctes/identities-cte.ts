import type { DataSourceSettings } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import { getBaseIdTypeAndJoins } from "back-end/src/util/sql";

import { getIdentitiesQuery } from "back-end/src/integrations/sql/queries/identities-query";

export type IdentityPlan = {
  baseIdType: string;
  joinsRequired: string[];
  idJoinMap: Record<string, string>;
};

export function getIdentitiesCTE(
  dialect: SqlDialect,
  settings: DataSourceSettings,
  {
    objects,
    from,
    to,
    forcedBaseIdType,
    experimentId,
    identityPlan,
  }: {
    objects: string[][];
    from: Date;
    to?: Date;
    forcedBaseIdType?: string;
    experimentId?: string;
    identityPlan?: IdentityPlan;
  },
): {
  baseIdType: string;
  idJoinSQL: string;
  idJoinMap: Record<string, string>;
} {
  const computedPlan =
    identityPlan ||
    (() => {
      const { baseIdType, joinsRequired } = getBaseIdTypeAndJoins(
        objects,
        forcedBaseIdType,
        settings?.queries?.identityJoins,
      );
      return {
        baseIdType,
        joinsRequired,
        idJoinMap: Object.fromEntries(
          joinsRequired.map((idType) => [
            idType,
            `__identities_${idType.replace(/[^a-zA-Z0-9_]/g, "")}`,
          ]),
        ),
      };
    })();
  const { baseIdType, joinsRequired } = computedPlan;

  // Joins for when an object doesn't support the baseIdType
  const joins: string[] = [];
  const idJoinMap: Record<string, string> = { ...computedPlan.idJoinMap };

  // Generate table names and SQL for each of the required joins
  joinsRequired.forEach((idType) => {
    const table =
      idJoinMap[idType] ||
      `__identities_${idType.replace(/[^a-zA-Z0-9_]/g, "")}`;
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
