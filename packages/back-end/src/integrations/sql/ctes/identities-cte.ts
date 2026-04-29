import type { DataSourceSettings } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
import type { IdentityPlan } from "shared/types/integrations";
import { getIdentitiesQuery } from "back-end/src/integrations/sql/queries/identities-query";

export type IdentitiesCteArgs = {
  identityPlan: IdentityPlan;
  from: Date;
  to?: Date;
  experimentId?: string;
};

export function getIdentitiesCTE(
  dialect: SqlDialect,
  settings: DataSourceSettings,
  identitiesCteArgs: IdentitiesCteArgs,
): {
  baseIdType: string;
  idJoinSQL: string;
  idJoinMap: Record<string, string>;
} {
  const { identityPlan, from, to, experimentId } = identitiesCteArgs;
  const { baseIdType, joinsRequired } = identityPlan;
  const joins: string[] = [];
  const idJoinMap: Record<string, string> = { ...identityPlan.idJoinMap };
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
