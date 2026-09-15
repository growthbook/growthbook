import { DimensionInterface } from "shared/types/dimension";

export function getDimensionCTE(
  dimension: DimensionInterface,
  baseIdType: string,
  idJoinMap: Record<string, string>,
): string {
  const userIdType = dimension.userIdType || "user_id";

  // Need to use an identity join table
  if (userIdType !== baseIdType) {
    return `-- Dimension (${dimension.name})
      SELECT
        i.${baseIdType},
        d.value
      FROM
        (
          ${dimension.sql}
        ) d
        JOIN ${idJoinMap[userIdType]} i ON ( i.${userIdType} = d.${userIdType} )
      `;
  }

  return `-- Dimension (${dimension.name})
    ${dimension.sql}
    `;
}
