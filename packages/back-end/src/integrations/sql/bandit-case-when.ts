import { SqlHelpers } from "shared/types/sql";

export function getBanditCaseWhen(
  helpers: SqlHelpers,
  periods: Date[],
): string {
  return `
        , CASE
          ${periods
            .sort((a, b) => b.getTime() - a.getTime())
            .map((p) => {
              return `WHEN first_exposure_timestamp >= ${helpers.toTimestamp(
                p,
              )} THEN ${helpers.toTimestamp(p)}`;
            })
            .join("\n")}
        END AS bandit_period`;
}
