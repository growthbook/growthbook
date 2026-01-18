import { Response } from "express";
import { getValidDate } from "shared/dates";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  DataVizConfig,
  SavedQuery,
  SavedQueryCreateProps,
  SavedQueryUpdateProps,
} from "shared/validators";
import {
  InformationSchemaTablesInterface,
  InformationSchemaInterface,
  Column,
} from "shared/types/integrations";
import { DataSourceInterface } from "shared/types/datasource";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { runFreeFormQuery } from "back-end/src/services/datasource";
import {
  secondsUntilAICanBeUsedAgain,
  parsePrompt,
} from "back-end/src/enterprise/services/ai";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import {
  createInformationSchemaTable,
  getInformationSchemaTableById,
} from "back-end/src/models/InformationSchemaTablesModel";
import { fetchTableData } from "back-end/src/services/informationSchema";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { IS_CLOUD } from "back-end/src/util/secrets";

/**
 * Ensures all dataVizConfig items have IDs. Adds IDs to any items that don't have them.
 */
function ensureDataVizIds(dataVizConfig: DataVizConfig[]): DataVizConfig[] {
  return dataVizConfig.map((config) => ({
    ...config,
    id: config.id || `data-viz_${uuidv4()}`,
  }));
}

export async function getSavedQueries(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    return res.status(200).json({
      status: 200,
      savedQueries: [],
    });
  }

  const savedQueries = await context.models.savedQueries.getAll();

  res.status(200).json({
    status: 200,
    savedQueries,
  });
}

export async function getSavedQueriesByIds(
  req: AuthRequest<null, { ids: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    return res.status(200).json({
      status: 200,
      savedQueries: [],
    });
  }

  const { ids } = req.params;
  const savedQueryIds = ids.split(",");

  const docs = await context.models.savedQueries.getByIds(savedQueryIds);

  // Lookup table so we can return queries in the same order we received them
  const map = new Map(docs.map((d) => [d.id, d]));

  res.status(200).json({
    status: 200,
    savedQueries: savedQueryIds.map((id) => map.get(id) || null),
  });
}

export async function getSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  const savedQuery = await context.models.savedQueries.getById(id);

  if (!savedQuery) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  res.status(200).json({
    status: 200,
    savedQuery,
  });
}

export async function postSavedQuery(
  req: AuthRequest<SavedQueryCreateProps>,
  res: Response,
) {
  const {
    name,
    sql,
    datasourceId,
    results,
    dateLastRan,
    dataVizConfig,
    linkedDashboardIds,
  } = req.body;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    context.throwPlanDoesNotAllowError(
      "Your organization's plan does not support saving queries",
    );
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  const savedQuery = await context.models.savedQueries.create({
    name,
    sql,
    datasourceId,
    dateLastRan: getValidDate(dateLastRan),
    results,
    dataVizConfig: ensureDataVizIds(dataVizConfig || []),
    linkedDashboardIds,
  });
  res.status(200).json({
    status: 200,
    id: savedQuery.id,
    savedQuery,
  });
}

export async function putSavedQuery(
  req: AuthRequest<SavedQueryUpdateProps, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    context.throwPlanDoesNotAllowError(
      "Your organization's plan does not support saving queries",
    );
  }

  const updateData = {
    ...req.body,
    dateLastRan: req.body.dateLastRan
      ? getValidDate(req.body.dateLastRan)
      : undefined,
    dataVizConfig: req.body.dataVizConfig
      ? ensureDataVizIds(req.body.dataVizConfig)
      : undefined,
  };

  const savedQuery = await context.models.savedQueries.updateById(
    id,
    updateData,
  );
  res.status(200).json({
    status: 200,
    savedQuery,
  });
}

export async function refreshSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    context.throwPlanDoesNotAllowError(
      "Your organization's plan does not support saving queries",
    );
  }

  const savedQuery = await context.models.savedQueries.getById(id);
  if (!savedQuery) {
    return res.status(404).json({
      status: 404,
      message: "Query not found",
    });
  }

  const datasource = await getDataSourceById(context, savedQuery.datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  const debugResults = await executeAndSaveQuery(
    context,
    savedQuery,
    datasource,
  );

  res.status(200).json({
    status: 200,
    debugResults,
  });
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  await context.models.savedQueries.deleteById(id);
  res.status(200).json({
    status: 200,
  });
}

export async function executeAndSaveQuery(
  context: ReqContext,
  savedQuery: SavedQuery,
  datasource: DataSourceInterface,
  limit: number = 1000,
) {
  const { results, sql, duration, error } = await runFreeFormQuery(
    context,
    datasource,
    savedQuery.sql,
    limit,
  );

  // Don't save if there was an error
  if (error || !results) {
    return {
      results: results,
      error,
      duration,
      sql,
    };
  }

  await context.models.savedQueries.update(savedQuery, {
    results: {
      results: results,
      error,
      duration,
      sql,
    },
    dateLastRan: new Date(),
  });
}

export async function postGenerateSQL(
  req: AuthRequest<{ input: string; datasourceId: string }>,
  res: Response,
) {
  const { input, datasourceId } = req.body;
  const context = getContextFromReq(req);
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    context.throwPlanDoesNotAllowError(
      "Your organization's plan does not support generating queries",
    );
  }
  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return res.status(404).json({
      status: 404,
      message: "Datasource not found",
    });
  }
  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context);
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }
  const informationSchema = await getInformationSchemaByDatasourceId(
    datasource.id,
    context.org.id,
  );

  if (!informationSchema) {
    return res.status(404).json({
      status: 404,
      message: "No informationSchema found for the datasource",
    });
  }
  if (!informationSchema?.databases?.length) {
    return res.status(404).json({
      status: 404,
      message: "No databases found in the information schema",
    });
  }
  const maxTables = 10;
  let isGA = false;
  const shardedTables = new Map();
  const dbSchemas = new Map();

  // check how many tables there are in the information schema:
  const tablesInfo = informationSchema.databases
    .flatMap((database) =>
      database.schemas.flatMap((schema) =>
        schema.tables.map((table) => {
          if (
            datasource.type === "bigquery" &&
            table.tableName.match(/.*_\d{8}$/)
          ) {
            const tableType =
              table.tableName.match(/(.*)_\d{8}$/)?.[1] || "unknown";
            if (tableType === "events") {
              isGA = true; // this is most likely a Google Analytics table
            }
            if (
              !shardedTables.has(
                database.databaseName + schema.schemaName + tableType,
              )
            ) {
              shardedTables.set(
                database.databaseName + schema.schemaName + tableType,
                true,
              );
              return {
                databaseName: database.databaseName,
                schemaName: schema.schemaName,
                tableName: tableType + "_*",
                numColumns: table.numOfColumns,
                id: table.id,
              };
            }
            return null; // skip this table if it's already sharded
          }
          return {
            databaseName: database.databaseName,
            schemaName: schema.schemaName,
            tableName: table.tableName,
            numColumns: table.numOfColumns,
            id: table.id,
          };
        }),
      ),
    )
    .filter((table) => table !== undefined && table !== null);

  let filteredTablesInfo = tablesInfo;
  // if there are more than maxTables, lets do a two part search, asking the AI to give its best guess as to which tables to use.
  const type = "generate-sql-query";
  const { prompt: userAdditionalPrompt, overrideModel } =
    await context.models.aiPrompts.getAIPrompt(type);
  if (filteredTablesInfo.length > maxTables) {
    const instructions =
      "You are a data analyst and SQL expert. " +
      "Please provide a list of the most relevant tables to use for provided input." +
      ". Return the Fully Qualified Table Name (FQTN). " +
      (datasource.type === "mysql"
        ? "The FQTN should be in the format: 'databaseName.tableName'. "
        : "The FQTN should be in the format: 'databaseName.schemaName.tableName'. ") +
      "The FQTN must be one of the following tables:" +
      "\n" +
      filteredTablesInfo
        .map(
          (table) =>
            `${table?.databaseName}.${table?.schemaName}.${table?.tableName}`,
        )
        .join(", ") +
      "\nReturn at most 20 FQTN tables. Return only the FQTN without any additional text or explanations." +
      (userAdditionalPrompt ? "\n" + userAdditionalPrompt : "");

    const zodObjectSchemaTables = z.object({
      table_names: z
        .array(z.string())
        .describe(
          "Fully Qualified Table Names (FQTN) in the format 'databaseName.schemaName.tableName' or 'databaseName.tableName' (for MySQL)",
        ),
    });
    try {
      const aiResultsTables = await parsePrompt({
        context,
        instructions,
        prompt: input,
        type: "generate-sql-query",
        overrideModel,
        isDefaultPrompt: true,
        zodObjectSchema: zodObjectSchemaTables,
        temperature: 0.1,
      });

      if (!aiResultsTables || typeof aiResultsTables.table_names !== "object") {
        return res.status(400).json({
          status: 400,
          message: "AI did not return the expected list of tables",
        });
      }
      const tableNames = Array.isArray(aiResultsTables.table_names)
        ? aiResultsTables.table_names
            .map((name) => name.trim())
            .filter((name) => name)
            .slice(0, 20)
        : [];

      // filter the tablesInfo to only include the ones that are in the AI response:
      filteredTablesInfo = tablesInfo.filter((table) =>
        tableNames.includes(
          `${table?.databaseName}.${table?.schemaName}.${table?.tableName}`,
        ),
      );
    } catch (e) {
      return res.status(400).json({
        status: 400,
        message:
          "AI did not return a valid SQL query. " + !IS_CLOUD ? e.message : "",
      });
    }

    if (filteredTablesInfo.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No relevant tables found based on AI response",
      });
    }
  }
  // for the tablesInfo/filteredTables, lets loop through them and fetch their schemas, from getInformationSchemaTableById() or fetchOrCreateTableSchema()
  for (const table of filteredTablesInfo) {
    // Sharded tables in BigQuery, as common with Google Analytics, can result in a huge number of tables, all of which share a schema.
    // This code tries to detect sharded tables, and not scan them all to get the schema, but rather just one of them.
    // we should probably find a better way to match sharded tables in bigquery...

    if (table.numColumns) {
      const tableSchema = await getInformationSchemaTableById(
        context.org.id,
        table.id,
      );
      if (!tableSchema) {
        // try to fetch the schema if not found:
        try {
          const tableSchemaData = await fetchOrCreateTableSchema({
            context,
            datasource,
            informationSchema,
            tableId: table.id,
            databaseName: table.databaseName,
            tableSchema: table.schemaName,
            tableName: table.tableName,
          });
          dbSchemas.set(table.id, tableSchemaData);
        } catch {
          // Ignoring errors
        }
      } else {
        dbSchemas.set(table.id, tableSchema);
      }
    }
  }

  const schemasString = Array.from(
    dbSchemas,
    ([, value]: [string, InformationSchemaTablesInterface]) => {
      const columnsDescription = value.columns
        .map((column) => `${column.columnName} (${column.dataType})`)
        .join(", ");
      return `Database: ${value.databaseName}, Table: ${value.tableName}, Schema name: ${value.tableSchema}, Columns: [${columnsDescription}]`;
    },
  ).join("\n");

  let instructions =
    "You are a data analyst and SQL expert.\n" +
    "Generate a SQL query to answer the provided question inputted. The resultant query should be ONLY based on the provided context of tables and structure, and return only valid SQL that is executable on the specified data source." +
    "\nThe database is a " +
    (datasource.type === "growthbook_clickhouse"
      ? "clickhouse"
      : datasource.type) +
    " database. Be sure to make queries valid for that database type." +
    (isGA ? " This database and tables are from Google Analytics." : "") +
    "\n\nTable structure: " +
    "\n" +
    schemasString +
    "\n\n" +
    "Use date ranges if possible and it makes sense with the input. If the input requests a date range, like 'in the past month', use the current date: " +
    new Date().toISOString() +
    " as the starting point.";

  if (datasource.type === "bigquery") {
    instructions +=
      "\n\nBe sure to use the schema name in the query, ie: databaseName.schemaName.tableName.\n" +
      "Keep in mind that the table names may be sharded, so you should use the generic table names " +
      "for tables that have wild cards, such as 'events_*'. If you are querying sharded tables, and " +
      "you're asked for a date range, you should use something like: " +
      "\n(_TABLE_SUFFIX BETWEEN 'yyyyMMdd' AND 'yyyyMMdd')" +
      "\nWhere yyyy is the full year, MM is the month, and dd is the day.\n when constructing the query " +
      "to make sure it's fast and makes use of the sharding. If you use this code, be sure to replace the dates with the correct range.\n" +
      "When generating BigQuery SQL, NEVER use TIMESTAMP_SUB or TIMESTAMP_ADD with date parts larger than DAY (such as MONTH, QUARTER, or YEAR), as this will cause an error.\n" +
      "If you need to subtract months from a TIMESTAMP column, follow this pattern:\n" +
      "\n" +
      "    Cast the TIMESTAMP to a DATETIME.\n" +
      "    Use DATETIME_SUB with the MONTH interval.\n" +
      "    Cast the result back to a TIMESTAMP if required.\n" +
      "\n" +
      "Example Correct Logic:\n" +
      "CAST(DATETIME_SUB(CAST(my_timestamp AS DATETIME), INTERVAL 1 MONTH) AS TIMESTAMP)";
  }

  if (userAdditionalPrompt) {
    instructions += "\n" + userAdditionalPrompt;
  }
  const zodObjectSchema = z.object({
    sql_string: z
      .string()
      .describe(
        "A syntactically valid SQL statement as instructed by the user",
      ),
  });
  try {
    const aiResults = await parsePrompt({
      context,
      instructions,
      prompt: input,
      type: "generate-sql-query",
      isDefaultPrompt: true,
      zodObjectSchema,
      temperature: 0.1,
      overrideModel,
    });

    if (!aiResults || typeof aiResults.sql_string !== "string") {
      return res.status(400).json({
        status: 400,
        message: "AI did not return the expected SQL string",
      });
    }
    res.status(200).json({
      status: 200,
      data: {
        sql: aiResults.sql_string,
      },
    });
  } catch (e) {
    return res.status(400).json({
      status: 400,
      message:
        "AI did not return a valid SQL query. " + (!IS_CLOUD ? e.message : ""),
    });
  }
}

async function fetchOrCreateTableSchema({
  context,
  datasource,
  informationSchema,
  tableId,
  databaseName,
  tableSchema,
  tableName,
}: {
  context: ReqContext | ApiReqContext;
  datasource: DataSourceInterface;
  informationSchema: InformationSchemaInterface;
  tableId: string;
  databaseName: string;
  tableSchema: string;
  tableName: string;
}) {
  const { tableData, refreshMS } = await fetchTableData(
    context,
    datasource,
    informationSchema,
    tableId,
  );
  if (!tableData) {
    throw new Error("no tables found in schema " + tableId);
  }

  const columns: Column[] = tableData.map(
    (row: { column_name: string; data_type: string }) => {
      return {
        columnName: row.column_name,
        dataType: row.data_type,
      };
    },
  );

  // Create the table record in Mongo.
  return await createInformationSchemaTable({
    organization: context.org.id,
    tableName,
    tableSchema,
    databaseName,
    columns,
    refreshMS,
    datasourceId: datasource.id,
    informationSchemaId: informationSchema.id,
    id: tableId,
  })
    .then((x) => {
      return x;
    })
    .catch((err) => {
      throw new Error("Error inserting new schema table: " + err.message);
    });
}
