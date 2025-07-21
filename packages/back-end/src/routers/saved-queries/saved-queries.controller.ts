import { Response } from "express";
import { getValidDate } from "shared/dates";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  getAISettingsForOrg,
  getContextFromReq,
} from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  SavedQueryCreateProps,
  SavedQueryUpdateProps,
} from "back-end/src/validators/saved-queries";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { runFreeFormQuery } from "back-end/src/services/datasource";
import {
  secondsUntilAICanBeUsedAgain,
  simpleCompletion,
} from "back-end/src/enterprise/services/openai";
import {
  InformationSchemaTablesInterface,
  InformationSchemaInterface,
} from "back-end/src/types/Integration";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import {
  getInformationSchemaTableById,
  insertNewSchemaTable,
} from "back-end/src/models/InformationSchemaTablesModel";
import { fetchTableData } from "back-end/src/services/informationSchema";
import { ReqContext } from "back-end/types/organization";
import { DataSourceInterface } from "back-end/types/datasource";
import { ApiReqContext } from "back-end/types/api";

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

export async function getSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
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
  res: Response
) {
  const {
    name,
    sql,
    datasourceId,
    results,
    dateLastRan,
    dataVizConfig,
  } = req.body;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }

  await context.models.savedQueries.create({
    name,
    sql,
    datasourceId,
    dateLastRan: getValidDate(dateLastRan),
    results,
    dataVizConfig,
  });
  res.status(200).json({
    status: 200,
  });
}

export async function putSavedQuery(
  req: AuthRequest<SavedQueryUpdateProps, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
  }

  const updateData = {
    ...req.body,
    dateLastRan: req.body.dateLastRan
      ? getValidDate(req.body.dateLastRan)
      : undefined,
  };

  await context.models.savedQueries.updateById(id, updateData);
  res.status(200).json({
    status: 200,
  });
}

export async function refreshSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  if (!orgHasPremiumFeature(context.org, "saveSqlExplorerQueries")) {
    throw new Error("Your organization's plan does not support saving queries");
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

  const { results, sql, duration, error } = await runFreeFormQuery(
    context,
    datasource,
    savedQuery.sql,
    1000
  );

  // Don't save if there was an error
  if (error || !results) {
    return res.json({
      status: 200,
      debugResults: {
        results: results,
        error,
        duration,
        sql,
      },
    });
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

  res.status(200).json({
    status: 200,
  });
}

export async function deleteSavedQuery(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { id } = req.params;
  const context = getContextFromReq(req);

  await context.models.savedQueries.deleteById(id);
  res.status(200).json({
    status: 200,
  });
}

export async function postGenerateSQL(
  req: AuthRequest<{ input: string; datasourceId: string }>,
  res: Response
) {
  const { input, datasourceId } = req.body;
  const context = getContextFromReq(req);
  const { aiEnabled } = getAISettingsForOrg(context);

  if (!orgHasPremiumFeature(context.org, "ai-suggestions")) {
    throw new Error(
      "Your organization's plan does not support generating queries"
    );
  }
  if (!aiEnabled) {
    return res.status(404).json({
      status: 404,
      message: "AI configuration not set or enabled",
    });
  }
  if (!req.organization) {
    return res.status(404).json({
      status: 404,
      message: "Organization not found",
    });
  }
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return res.status(404).json({
      status: 404,
      message: "Datasource not found",
    });
  }
  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(
    req.organization
  );
  if (secondsUntilReset > 0) {
    return res.status(429).json({
      status: 429,
      message: "Over AI usage limits",
      retryAfter: secondsUntilReset,
    });
  }
  const informationSchema = await getInformationSchemaByDatasourceId(
    datasource.id,
    context.org.id
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
  const errors = [];

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
                database.databaseName + schema.schemaName + tableType
              )
            ) {
              shardedTables.set(
                database.databaseName + schema.schemaName + tableType,
                true
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
        })
      )
    )
    .filter((table) => table !== undefined && table !== null);

  // if there are more than maxTables, lets do a two part search, asking the AI to give its best guess as to which tables to use.
  if (tablesInfo.length > maxTables) {
    const instructions =
      "You are a data analyst and SQL expert. " +
      "Please provide a list of the most relevant tables to use for the following question: " +
      input +
      ". " +
      "The list should be in the format: 'databaseName.schemaName.tableName'. " +
      "The tables must be one of the following tables:" +
      "\n" +
      tablesInfo
        .map(
          (table) =>
            `${table?.databaseName}.${table?.schemaName}.${table?.tableName}`
        )
        .join(", ") +
      "Return at most 20 tables. Return only the table names, separated by commas, without any additional text or explanations.";

    const aiResults = await simpleCompletion({
      context,
      instructions,
      prompt:
        "Return table names only, no markdown, no explanation, no comments.",
      type: "generate-sql-query",
      isDefaultPrompt: true,
      temperature: 0.1,
    });

    const tableNames = aiResults
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name);

    // filter the tablesInfo to only include the ones that are in the AI response:
    const filteredTablesInfo = tablesInfo.filter((table) =>
      tableNames.includes(
        `${table?.databaseName}.${table?.schemaName}.${table?.tableName}`
      )
    );

    if (filteredTablesInfo.length === 0) {
      return res.status(404).json({
        status: 404,
        message: "No relevant tables found based on AI response",
      });
    }

    // for the filteredTables, lets loop through them and fetch their schemas, from getInformationSchemaTableById() or fetchOrCreateTableSchema()
    for (const table of filteredTablesInfo) {
      // Sharded tables in BigQuery, as common with Google Analytics, can result in a huge number of tables, all of which share a schema.
      // This code tries to detect sharded tables, and not scan them all to get the schema, but rather just one of them.
      // we should probably find a better way to match sharded tables in bigquery...

      if (table.numColumns) {
        const tableSchema = await getInformationSchemaTableById(
          context.org.id,
          table.id
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
          } catch (error) {
            errors.push(error);
          }
        } else {
          dbSchemas.set(table.id, tableSchema);
        }
      }
    }
  } else {
    // Loop through the tablesInfo array
    for (const table of tablesInfo) {
      if (table.numColumns) {
        const tableSchema = await getInformationSchemaTableById(
          context.org.id,
          table.id
        );
        if (!tableSchema) {
          // Try to fetch the schema if not found
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
          } catch (error) {
            errors.push(error);
          }
        } else {
          dbSchemas.set(table.id, tableSchema);
        }
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
    }
  ).join("\n");

  let instructions =
    "You are a data analyst and SQL expert.\n" +
    "Generate a SQL query to answer the provided question inputted. The resultant query should be ONLY based on the provided context of tables and structure, and return only valid SQL that is executable on the specified data source." +
    "\n\nThe database is a " +
    (datasource.type === "growthbook_clickhouse"
      ? "clickhouse"
      : datasource.type) +
    " database. Be sure to make queries valid for that database type." +
    (isGA ? " This database and tables from Google Analytics." : "") +
    "\n\nTable structure: " +
    "\n" +
    schemasString +
    "\n\nInput: " +
    input +
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
      "to make sure it's fast and takes use of the sharding. If you use this code, be sure to replace the dates with the correct range.\n";
  }

  const aiResults = await simpleCompletion({
    context,
    instructions,
    prompt: "Return SQL only, no markdown, no explanation, no comments.",
    type: "generate-sql-query",
    isDefaultPrompt: true,
    temperature: 0.1,
  });

  // sometimes, even though we ask it not to, it returns in markdown:
  const cleanSQL = aiResults.startsWith("```")
    ? aiResults.replace(/```sql|```/g, "").trim()
    : aiResults;

  res.status(200).json({
    status: 200,
    data: {
      sql: cleanSQL,
    },
  });
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
    tableId
  );
  if (!tableData) {
    throw new Error("no tables found in schema " + tableId);
  }
  return await insertNewSchemaTable({
    tableData,
    organizationId: context.org.id,
    datasource,
    informationSchema,
    databaseName,
    tableSchema,
    tableName,
    refreshMS,
    tableId: tableId,
  })
    .then((x) => {
      return x;
    })
    .catch((err) => {
      throw new Error("Error inserting new schema table: " + err.message);
    });
}
