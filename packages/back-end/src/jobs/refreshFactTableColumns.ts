import Agenda, { Job } from "agenda";
import { canInlineFilterColumn } from "shared/experiments";
import { ReqContext } from "back-end/types/organization";
import {
  getFactTable,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  JSONColumnFields,
} from "back-end/types/fact-table";
import { determineColumnTypes } from "back-end/src/util/sql";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { DataSourceInterface } from "back-end/types/datasource";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { trackJob } from "back-end/src/services/tracing";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "refreshFactTableColumns";
type RefreshFactTableColumnsJob = Job<{
  organization: string;
  factTableId: string;
}>;

const refreshFactTableColumns = trackJob(
  JOB_NAME,
  async (job: RefreshFactTableColumnsJob) => {
    const { organization, factTableId } = job.attrs.data;

    if (!factTableId || !organization) return;

    const context = await getContextForAgendaJobByOrgId(organization);

    const factTable = await getFactTable(context, factTableId);
    if (!factTable) return;

    const datasource = await getDataSourceById(context, factTable.datasource);
    if (!datasource) return;

    const updates: Partial<
      Pick<FactTableInterface, "columns" | "columnsError">
    > = {};

    try {
      const columns = await runRefreshColumnsQuery(
        context,
        datasource,
        factTable
      );
      updates.columns = columns;
      updates.columnsError = null;
    } catch (e) {
      updates.columnsError = e.message;
    }

    await updateFactTableColumns(factTable, updates);
  }
);

export async function runColumnTopValuesQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName">,
  column: ColumnInterface
): Promise<string[]> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (
    !integration.getColumnTopValuesQuery ||
    !integration.runColumnTopValuesQuery
  ) {
    throw new Error("Top values not supported on this data source");
  }

  const sql = integration.getColumnTopValuesQuery({
    factTable,
    column,
    limit: 100,
  });

  const result = await integration.runColumnTopValuesQuery(sql);

  return result.rows.map((r) => r.value);
}

export async function runRefreshColumnsQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "columns" | "userIdTypes"
  >
): Promise<ColumnInterface[]> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  const sql = integration.getTestQuery({
    query: factTable.sql,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: context.org.settings?.testQueryDays,
    limit: 20,
  });

  const result = await integration.runTestQuery(sql, ["timestamp"]);

  const typeMap = new Map<string, FactTableColumnType>();
  const jsonMap = new Map<string, JSONColumnFields>();
  determineColumnTypes(result.results).forEach((col) => {
    typeMap.set(col.column, col.datatype);
    if (col.jsonFields) {
      jsonMap.set(col.column, col.jsonFields);
    }
  });

  const columns = factTable.columns || [];

  // Update existing column
  columns.forEach((col) => {
    const type = typeMap.get(col.column);
    const jsonFields = jsonMap.get(col.column);

    // Column no longer exists, mark as deleted
    if (type === undefined) {
      col.deleted = true;
      col.dateUpdated = new Date();
    }
    // Column exists
    else {
      if (col.deleted) {
        col.deleted = false;
        col.dateUpdated = new Date();
      }

      // If we now know the datatype, update it
      if (col.datatype === "" && type !== "") {
        col.datatype = type;
        col.jsonFields = jsonFields;
        col.dateUpdated = new Date();
      }
      // If this is a JSON column, merge in the JSON fields
      else if (col.datatype === "json" && jsonFields !== undefined) {
        // Merge existing JSON fields with new ones (prefering existing)
        const newJSONFields = { ...col.jsonFields };
        let hasNewFields = false;
        for (const key in jsonFields) {
          if (!newJSONFields[key]) {
            newJSONFields[key] = jsonFields[key];
            hasNewFields = true;
          }
        }
        if (hasNewFields) {
          col.jsonFields = newJSONFields;
          col.dateUpdated = new Date();
        }
      }
    }
  });

  // Add new columns that don't exist yet
  typeMap.forEach((datatype, column) => {
    if (!columns.some((c) => c.column === column)) {
      columns.push({
        column,
        datatype,
        jsonFields: jsonMap.get(column),
        dateCreated: new Date(),
        dateUpdated: new Date(),
        description: "",
        name: column,
        numberFormat: "",
        deleted: false,
      });
    }
  });

  for (const col of columns) {
    if (
      col.alwaysInlineFilter &&
      canInlineFilterColumn(factTable, col.column)
    ) {
      try {
        col.topValues = await runColumnTopValuesQuery(
          context,
          datasource,
          factTable,
          col
        );
        col.topValuesDate = new Date();
      } catch (e) {
        logger.error("Error running top values query", e);
      }
    }
  }

  return columns;
}

let agenda: Agenda;
export default function (ag: Agenda) {
  agenda = ag;

  agenda.define(JOB_NAME, refreshFactTableColumns);
}

export async function queueFactTableColumnsRefresh(
  factTable: FactTableInterface
) {
  const job = agenda.create(JOB_NAME, {
    organization: factTable.organization,
    factTableId: factTable.id,
  }) as RefreshFactTableColumnsJob;
  job.unique({
    organization: factTable.organization,
    factTableId: factTable.id,
  });
  job.schedule(new Date());
  await job.save();
}
