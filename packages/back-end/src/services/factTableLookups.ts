import isEqual from "lodash/isEqual";
import type {
  ColumnLookup,
  FactTableColumnType,
  FactTableInterface,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getFactTable,
  mergeUpsertColumns,
} from "back-end/src/models/FactTableModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { validateLookupReferences } from "back-end/src/util/factTable";

/**
 * Every write path that can set a lookup runs this: the Data Source must
 * support lookup columns, and the lookup's keys and source must resolve.
 * Returns the remote column's datatype for a Fact Table source (the lookup
 * column should carry it), `null` for SQL and table sources.
 */
export async function validateLookupWrite(
  context: ReqContext | ApiReqContext,
  factTable: Pick<FactTableInterface, "id" | "datasource" | "columns">,
  lookup: ColumnLookup,
): Promise<FactTableColumnType | null> {
  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new Error("Could not find the Fact Table's Data Source");
  }
  const properties = getSourceIntegrationObject(
    context,
    datasource,
  ).getSourceProperties();
  if (!properties.supportsLookupColumns) {
    throw new Error("Lookup columns aren't supported on this Data Source");
  }

  const source =
    lookup.type === "factTable"
      ? await getFactTable(context, lookup.factTableId)
      : null;
  return validateLookupReferences({ factTable, lookup, source });
}

/**
 * For bulk column writes (fact table create/update, bulk import): validates
 * each new or changed incoming lookup against the table's resulting columns,
 * and sets its datatype from a Fact Table source. An unchanged lookup is
 * skipped, so round-tripping a table's columns never fails on it.
 */
export async function validateLookupColumnsWrite(
  context: ReqContext | ApiReqContext,
  factTable: Pick<FactTableInterface, "id" | "datasource" | "columns">,
  incoming: Array<UpdateColumnProps & { column: string }>,
): Promise<void> {
  const changed = incoming.filter(
    (col) =>
      col.lookup &&
      !isEqual(
        col.lookup,
        factTable.columns.find((c) => c.column === col.column)?.lookup,
      ),
  );
  if (!changed.length) return;

  const { columns } = mergeUpsertColumns(factTable.columns, incoming);
  for (const col of changed) {
    if (!col.lookup) continue;
    const datatype = await validateLookupWrite(
      context,
      { ...factTable, columns },
      col.lookup,
    );
    if (datatype) col.datatype = datatype;
  }
}
