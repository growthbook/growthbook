import type { DataSourceSettings } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";

import { getIdentitiesQuery } from "back-end/src/integrations/sql/queries/identities-query";

export type IdentityPlan = {
  baseIdType: string;
  joinsRequired: string[];
  idJoinMap: Record<string, string>;
};

export function getIdentitiesCTE(
  dialect: SqlDialect,
  settings: DataSourceSettings,
  identityPlan: IdentityPlan,
  from: Date,
  to?: Date,
  experimentId?: string,
): {
  baseIdType: string;
  idJoinSQL: string;
  idJoinMap: Record<string, string>;
} {
  const computedPlan = identityPlan;
  const { baseIdType, joinsRequired } = computedPlan;
  const joins: string[] = [];
  const idJoinMap: Record<string, string> = { ...computedPlan.idJoinMap };
  joinsRequired.forEach((idType) => {
    joins.push(
      `${idJoinMap[idType]} as (
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
