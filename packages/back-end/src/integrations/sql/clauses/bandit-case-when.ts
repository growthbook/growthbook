import { SqlDialect } from "shared/types/sql";

export function getBanditCaseWhen(
  dialect: SqlDialect,
  periods: Date[],
): string {
  return `
        , CASE
          ${periods
            .sort((a, b) => b.getTime() - a.getTime())
            .map((p) => {
              return `WHEN first_exposure_timestamp >= ${dialect.toTimestamp(
                p,
              )} THEN ${dialect.toTimestamp(p)}`;
            })
            .join("\n")}
        END AS bandit_period`;
}
