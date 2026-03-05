import Agenda, { Job } from "agenda";
import chunk from "lodash/chunk";
import { canInlineFilterColumn } from "shared/experiments";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  JSONColumnFields,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { ReqContext } from "back-end/types/request";
import {
  getFactTable,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { determineColumnTypes } from "back-end/src/util/sql";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { deriveUserIdTypesFromColumns } from "back-end/src/util/factTable";
import { logger } from "back-end/src/util/logger";

const JOB_NAME = "refreshFactTableColumns";
type RefreshFactTableColumnsJob = Job<{
  organization: string;
  factTableId: string;
}>;

const refreshFactTableColumns = async (job: RefreshFactTableColumnsJob) => {
  const { organization, factTableId } = job.attrs.data;

  if (!factTableId || !organization) return;

  const context = await getContextForAgendaJobByOrgId(organization);

  const factTable = await getFactTable(context, factTableId);
  if (!factTable) return;

  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) return;

  const updates: Partial<
    Pick<
      FactTableInterface,
      "columns" | "columnsError" | "columnRefreshPending" | "userIdTypes"
    >
  > = {};

  try {
    const columns = await runRefreshColumnsQuery(
      context,
      datasource,
      factTable,
    );
    updates.columns = columns;
    updates.columnsError = null;

    updates.userIdTypes = deriveUserIdTypesFromColumns(datasource, columns);
  } catch (e) {
    updates.columnsError = e.message;
  }

  // Always set columnRefreshPending to false - job is done (even if it failed)
  updates.columnRefreshPending = false;
  await updateFactTableColumns(factTable, updates, context);
};

export async function runColumnsTopValuesQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<FactTableInterface, "sql" | "eventName">,
  columns: ColumnInterface[],
): Promise<Record<string, string[]>> {
  if (!context.permissions.canRunFactQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);

  if (
    !integration.getColumnsTopValuesQuery ||
    !integration.runColumnsTopValuesQuery
  ) {
    throw new Error("Top values not supported on this data source");
  }

  if (columns.length === 0) {
    return {};
  }

  const sql = integration.getColumnsTopValuesQuery({
    factTable,
    columns,
    limit: Math.max(
      100,
      context.org.settings?.maxMetricSliceLevels ??
        DEFAULT_MAX_METRIC_SLICE_LEVELS,
    ),
  });
  const result = await integration.runColumnsTopValuesQuery(sql);

  // Group results by column name
  const columnValues: Record<string, string[]> = {};
  for (const row of result.rows) {
    if (!columnValues[row.column]) {
      columnValues[row.column] = [];
    }
    columnValues[row.column].push(row.value);
  }

  return columnValues;
}

export function populateAutoSlices(
  col: ColumnInterface,
  topValues: string[],
  maxValues?: number,
): string[] {
  if (col.datatype === "boolean") {
    return ["true", "false"];
  }

  // Use existing autoSlices if they exist, otherwise use topValues up to the max
  if (col.autoSlices && col.autoSlices.length > 0) {
    return col.autoSlices;
  }
  const maxSliceLevels = maxValues ?? DEFAULT_MAX_METRIC_SLICE_LEVELS;
  const autoSlices: string[] = [];
  for (const value of topValues) {
    if (autoSlices.length >= maxSliceLevels) break;
    if (!autoSlices.includes(value)) {
      autoSlices.push(value);
    }
  }

  return autoSlices;
}

export async function runRefreshColumnsQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: Pick<
    FactTableInterface,
    "sql" | "eventName" | "columns" | "userIdTypes"
  >,
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

  result.columns?.forEach((col) => {
    // If the underlying SQL engine returned the datatype, use it
    if (col.dataType !== undefined) {
      // For JSON, only return if we have the field information, otherwise skip
      // so we can infer from the returned data
      if (
        col.dataType === "json" &&
        col.fields !== undefined &&
        col.fields.length > 0
      ) {
        typeMap.set(col.name, "json");
        jsonMap.set(
          col.name,
          col.fields.reduce(
            (acc, field) => ({
              ...acc,
              [field.name]: {
                datatype: field.dataType,
              },
            }),
            {},
          ),
        );
      } else if (col.dataType !== "json") {
        typeMap.set(col.name, col.dataType);
      }
    }
  });

  determineColumnTypes(result.results, typeMap).forEach((col) => {
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

  // Collect columns that need top values
  const columnsNeedingTopValues: ColumnInterface[] = [];
  for (const col of columns) {
    if (col.numberFormat === undefined) {
      col.numberFormat = "";
    }

    if (col.datatype === "boolean" && col.isAutoSliceColumn) {
      col.autoSlices = ["true", "false"];
    } else if (
      (col.alwaysInlineFilter || col.isAutoSliceColumn) &&
      canInlineFilterColumn(factTable, col.column) &&
      col.datatype === "string"
    ) {
      columnsNeedingTopValues.push(col);
    }
  }

  // Batch query for all columns that need top values, chunked into groups of 10
  // to prevent returning more than 1k rows per update (10 columns * 100 values = 1000 rows max per chunk)
  if (columnsNeedingTopValues.length > 0) {
    const columnChunks = chunk(columnsNeedingTopValues, 10);

    for (const columnChunk of columnChunks) {
      try {
        const topValuesByColumn = await runColumnsTopValuesQuery(
          context,
          datasource,
          factTable,
          columnChunk,
        );

        // Process results for each column
        for (const col of columnChunk) {
          const topValues = topValuesByColumn[col.column] || [];
          col.topValues = topValues;
          col.topValuesDate = new Date();

          if (col.isAutoSliceColumn) {
            col.autoSlices = populateAutoSlices(
              col,
              topValues,
              context.org.settings?.maxMetricSliceLevels,
            );
          }
        }
      } catch (e) {
        logger.error(e, "Error running top values query", {
          columns: columnChunk.map((c) => c.column),
        });
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
  factTable: Pick<FactTableInterface, "id" | "organization">,
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
