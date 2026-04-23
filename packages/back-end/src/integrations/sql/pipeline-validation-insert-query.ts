import { SqlHelpers } from "shared/types/sql";

export function getPipelineValidationInsertQuery(
  helpers: SqlHelpers,
  {
    tableFullName,
  }: {
    tableFullName: string;
  },
): string {
  return `INSERT INTO
      ${tableFullName}
      (user_id, variation, first_exposure_timestamp)
      VALUES
      ('user_3', 'A', ${helpers.getCurrentTimestamp()})
    `;
}
