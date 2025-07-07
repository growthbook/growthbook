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
import { simpleCompletion } from "back-end/src/enterprise/services/openai";
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
  const maxTables = 100;
  const shardedTables = new Map();
  const dbSchemas = new Map();
  const errors = [];
  // for reach databases in the information schema, check if the table exists
  if (informationSchema?.databases.length) {
    // loop through the databases
    for (const database of informationSchema.databases) {
      if (dbSchemas.size >= maxTables) break; // Stop if maxTables is reached
      if (database.schemas.length) {
        // loop through the schemas
        for (const schema of database.schemas) {
          if (dbSchemas.size >= maxTables) break; // Stop if maxTables is reached
          if (schema.tables.length) {
            // loop through the tables
            for (const table of schema.tables) {
              if (dbSchemas.size >= maxTables) break; // Stop if maxTables is reached
              // Sharded tables in BigQuery, as common with Google Analytics, can result in a huge number of tables, all of which share a schema.
              // This code tries to detect sharded tables, and not scan them all to get the schema, but rather just one of them.
              // we should probably find a better way to match sharded tables in bigquery...
              if (table.tableName.match(/.*_\d{8}$/)) {
                const tableType =
                  table?.tableName?.match(/(.*)_\d{8}$/)?.[1] || "unknown";
                if (!shardedTables.has(tableType)) {
                  // insert the table into the dbSchemas map
                  const tableSchema = await getInformationSchemaTableById(
                    context.org.id,
                    table.id
                  );
                  if (!tableSchema) {
                    // try to fetch the schema if not found
                    try {
                      const tableSchema = await fetchOrCreateTableSchema({
                        context,
                        datasource,
                        informationSchema,
                        tableId: table.id,
                        databaseName: database.databaseName,
                        tableSchema: schema.schemaName,
                        tableName: table.tableName,
                      });
                      tableSchema.tableName = tableType + "_*"; // set the table name to a generic name for GA events
                      dbSchemas.set(table.id, tableSchema);
                    } catch (error) {
                      errors.push(error);
                      continue;
                    }
                  } else {
                    //console.log("valid tableSchema is", tableSchema);
                    tableSchema.tableName = tableType + "_*"; // set the table name to a generic name for GA events
                    dbSchemas.set(table.id, tableSchema);
                  }
                  shardedTables.set(tableType, true);
                }
              } else {
                if (table?.numOfColumns) {
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
                        databaseName: database.databaseName,
                        tableSchema: schema.schemaName,
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
          } else {
            errors.push("no tables found in schema " + schema.schemaName);
          }
        }
      } else {
        errors.push("no schemas found in database " + database.databaseName);
      }
    }
  } else {
    errors.push("no databases found in information schema");
  }

  const schemasString = Array.from(
    dbSchemas,
    ([, value]: [string, InformationSchemaTablesInterface]) => {
      const columnsDescription = value.columns
        .map((column) => `${column.columnName} (${column.dataType})`)
        .join(", ");
      return `Database: ${value.databaseName}, Table: ${value.tableName}, Schema: ${value.tableSchema}, Columns: [${columnsDescription}]`;
    }
  ).join("\n");

  const instructions =
    "You are a data analyst and SQL expert.\n" +
    "Generate a SQL query to answer the provided question inputted. The resultant query should be ONLY based on the provided context of tables and structure, and return only valid SQL that is executable on the specified data source." +
    "\n\nTable structure: " +
    "\n" +
    schemasString +
    "\n\nInput: " +
    input +
    "\n\nKeep in mind that the table names may be sharded, so you should use the generic table names for tables that have wild cards, such as 'events_*'. If you are querying sharded tables, and you're asked for a date range, you should use something like: \n((_TABLE_SUFFIX BETWEEN '{{date startDateISO \"yyyyMMdd\"}}' AND '{{date endDateISO \"yyyyMMdd\"}}') OR\n" +
    "   (_TABLE_SUFFIX BETWEEN 'intraday_{{date startDateISO \"yyyyMMdd\"}}' AND 'intraday_{{date endDateISO \"yyyyMMdd\"}}'))\n\n when constructing the query to make sure it's fast and takes use of the sharding. If you do this code, be sure to replace the dates with the correct range.\n";

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
