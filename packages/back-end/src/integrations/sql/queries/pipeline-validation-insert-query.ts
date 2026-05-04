import { SqlDialect } from "shared/types/sql";

export function getPipelineValidationInsertQuery(
  dialect: SqlDialect,
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
      ('user_3', 'A', ${dialect.getCurrentTimestamp()})
    `;
}
