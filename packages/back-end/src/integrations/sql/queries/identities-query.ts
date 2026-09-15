import { DataSourceSettings } from "shared/types/datasource";
import { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getIdentitiesQuery(
  dialect: SqlDialect,
  settings: DataSourceSettings,
  id1: string,
  id2: string,
  from: Date,
  to: Date | undefined,
  experimentId?: string,
): string {
  if (settings?.queries?.identityJoins) {
    for (let i = 0; i < settings.queries.identityJoins.length; i++) {
      const join = settings?.queries?.identityJoins[i];
      if (
        join.query.length > 6 &&
        join.ids.includes(id1) &&
        join.ids.includes(id2)
      ) {
        return `
          SELECT
            ${id1},
            ${id2}
          FROM
            (
              ${compileSqlTemplate(
                join.query,
                {
                  startDate: from,
                  endDate: to,
                  experimentId,
                },
                dialect,
              )}
            ) i
          GROUP BY
            ${id1}, ${id2}
          `;
      }
    }
  }
  if (settings?.queries?.pageviewsQuery) {
    const timestampColumn = "i.timestamp";

    if (
      ["user_id", "anonymous_id"].includes(id1) &&
      ["user_id", "anonymous_id"].includes(id2)
    ) {
      return `
        SELECT
          user_id,
          anonymous_id
        FROM
          (${compileSqlTemplate(
            settings.queries.pageviewsQuery,
            {
              startDate: from,
              endDate: to,
              experimentId,
            },
            dialect,
          )}) i
        WHERE
          ${timestampColumn} >= ${dialect.toTimestamp(from)}
          ${to ? `AND ${timestampColumn} <= ${dialect.toTimestamp(to)}` : ""}
        GROUP BY
          user_id, anonymous_id
        `;
    }
  }

  throw new Error(`Missing identifier join table for '${id1}' and '${id2}'.`);
}
