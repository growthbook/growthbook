import {
  getFactTableTemplateVariables,
  makeLookupResolver,
  type LookupResolver,
} from "shared/experiments";
import type { FactTableMap } from "shared/types/fact-table";
import type { SQLVars, SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

/**
 * Lookup resolver for warehouse queries. A Fact Table source is compiled with
 * its own template variables (so `{{eventName}}` is the source's, not the
 * filtered table's) plus the query's date range; SQL and table sources get the
 * date range only. Nothing bounds the source by date beyond what its SQL does.
 */
export function makeSqlLookupResolver(
  dialect: SqlDialect,
  {
    factTableMap,
    datasourceId,
    sqlVars,
  }: {
    factTableMap: FactTableMap;
    datasourceId: string;
    sqlVars: Omit<SQLVars, "templateVariables">;
  },
): LookupResolver {
  return makeLookupResolver({
    factTableMap,
    datasourceId,
    getSql: (rawSql, factTable) =>
      compileSqlTemplate(
        rawSql,
        factTable
          ? {
              ...sqlVars,
              templateVariables: getFactTableTemplateVariables(factTable),
            }
          : sqlVars,
        dialect,
      ),
  });
}
