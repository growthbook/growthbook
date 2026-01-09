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
import { UpdateProps } from "shared/types/base-model";
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

/**
 * Normalizes query results by converting Decimal.js objects to strings/numbers.
 * This prevents Decimal.js objects from being saved to MongoDB in their internal format.
 */
function normalizeQueryResults(
  results: Record<string, unknown>[] | undefined,
): Record<string, unknown>[] | undefined {
  if (!results || !Array.isArray(results)) {
    return results;
  }

  return results.map((row) => {
    const normalizedRow: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalizedRow[key] = normalizeValue(value);
    }
    return normalizedRow;
  });
}

/**
 * Recursively normalizes a value, converting Decimal.js objects to strings.
 */
function normalizeValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  // Check if it's a Decimal.js object structure
  // Decimal.js objects have s (sign), e (exponent), and c (coefficient) properties
  if (
    typeof value === "object" &&
    value !== null &&
    "s" in value &&
    "e" in value &&
    "c" in value &&
    Array.isArray(value.c) &&
    typeof value.s === "number" &&
    typeof value.e === "number"
  ) {
    try {
      // Reconstruct the number from Decimal.js internal representation
      const decimalObj = value as { s: number; e: number; c: number[] };

      // Handle zero case
      if (
        decimalObj.c.length === 0 ||
        (decimalObj.c.length === 1 && decimalObj.c[0] === 0)
      ) {
        return "0";
      }

      // Reconstruct the number string
      const coefficientStr = decimalObj.c.join("");
      const exponent = decimalObj.e - (decimalObj.c.length - 1);
      const sign = decimalObj.s === -1 ? "-" : "";

      let numStr: string;
      if (exponent >= 0) {
        numStr = coefficientStr + "0".repeat(exponent);
      } else {
        const absExp = Math.abs(exponent);
        if (absExp <= coefficientStr.length) {
          const insertPos = coefficientStr.length - absExp;
          numStr =
            coefficientStr.slice(0, insertPos) +
            "." +
            coefficientStr.slice(insertPos);
        } else {
          numStr =
            "0." + "0".repeat(absExp - coefficientStr.length) + coefficientStr;
        }
      }

      // Return as string to preserve precision
      return sign + numStr;
    } catch {
      // If reconstruction fails, return as-is
      return value;
    }
  }

  // Handle arrays recursively
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  // Handle objects recursively (but skip Date objects)
  if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      normalized[k] = normalizeValue(v);
    }
    return normalized;
  }

  // Return primitives as-is
  return value;
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
    throw new Error("Your organization's plan does not support saving queries");
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
    results: results
      ? {
          ...results,
          results: normalizeQueryResults(results.results) || [],
        }
      : results,
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
    throw new Error("Your organization's plan does not support saving queries");
  }

  const updateData: UpdateProps<SavedQuery> = {
    ...req.body,
    dateLastRan: req.body.dateLastRan
      ? getValidDate(req.body.dateLastRan)
      : undefined,
    dataVizConfig: req.body.dataVizConfig
      ? ensureDataVizIds(req.body.dataVizConfig)
      : undefined,
    results: req.body.results
      ? {
          ...req.body.results,
          results: normalizeQueryResults(req.body.results.results) || [],
        }
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
      results: normalizeQueryResults(results) || [],
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
    throw new Error(
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
  const secondsUntilReset = await secondsUntilAICanBeUsedAgain(context.org);
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
