import { format } from "shared/sql";
import { SqlDialect } from "shared/types/sql";
import { FactTableMap } from "shared/types/fact-table";
import { PopulationStep } from "../../validators/population";

export type PopulationSqlParams = {
  steps: PopulationStep[];
  userIdType: string;
  factTableMap: FactTableMap;
  dialect: SqlDialect;
};

// Standalone so it can be pasted into the SQL Explorer: one row per unit.
export function buildPopulationSql(params: PopulationSqlParams): string {
  const { userIdType, factTableMap, dialect, steps } = params;
  const step = steps[0];

  const conditions = step.rowFilters.map((filter) => {
    // there's gotta be a shared rowFilters parser, right?
    const column = filter.column;
    const operator = filter.operator;
    const values = filter.values?.join(",") ?? "";
    return `${column} ${operator} '${values}'`;
  });

  return format(
    `SELECT ${userIdType} FROM (${factTableMap.get(step.source.factTableId)?.sql})
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    `,
    dialect.formatDialect,
  );
}
