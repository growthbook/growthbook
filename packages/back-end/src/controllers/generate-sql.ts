import { Request, Response } from "express";
import { z } from "zod";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import {
  hasExceededUsageQuota,
  simpleCompletion,
} from "back-end/src/services/openai";
import { ApiRequestLocals } from "back-end/types/api";

const informationSchemaSchema = z.object({
  databases: z.array(
    z.object({
      databaseName: z.string(),
      path: z.string().optional(),
      schemas: z.array(
        z.object({
          schemaName: z.string(),
          path: z.string().optional(),
          tables: z.array(
            z.object({
              tableName: z.string(),
              path: z.string().optional(),
              columns: z
                .array(
                  z.object({
                    columnName: z.string(),
                    dataType: z.string(),
                  })
                )
                .optional(),
            })
          ),
        })
      ),
    })
  ),
});

type InformationSchema = z.infer<typeof informationSchemaSchema>;

export const generateSqlSchema = z.object({
  naturalLanguage: z.string().min(1),
  datasourceId: z.string().optional(),
  datasourceType: z.enum([
    "growthbook_clickhouse",
    "redshift",
    "athena",
    "google_analytics",
    "snowflake",
    "postgres",
    "mysql",
    "mssql",
    "bigquery",
    "clickhouse",
    "presto",
    "databricks",
    "mixpanel",
    "vertica",
  ] as const),
  informationSchema: informationSchemaSchema.optional(),
});

export async function generateSql(
  req: Request & ApiRequestLocals,
  res: Response
) {
  const { naturalLanguage, datasourceType, informationSchema } = req.body;

  // Check if OpenAI integration is enabled
  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({
      message: "OpenAI integration is not enabled",
    });
  }

  // Check if the organization has exceeded their usage quota
  if (await hasExceededUsageQuota(req.organization)) {
    return res.status(400).json({
      message: "Organization has exceeded their OpenAI usage quota",
    });
  }

  // Step 1: Identify relevant tables for the query
  const tableIdentificationPrompt = `Based on this request, identify which tables are needed: ${naturalLanguage}

Tables: ${
    informationSchema
      ? informationSchema.databases
          .map((db: InformationSchema["databases"][0]) =>
            db.schemas
              .map((schema: InformationSchema["databases"][0]["schemas"][0]) =>
                schema.tables
                  .map(
                    (
                      table: InformationSchema["databases"][0]["schemas"][0]["tables"][0]
                    ) =>
                      `${db.databaseName}.${schema.schemaName}.${table.tableName}`
                  )
                  .join(",")
              )
              .join(",")
          )
          .join(",")
      : ""
  }

For intraday tables, use wildcard patterns (e.g., 'events_*').
Return a raw JSON array of table names, without any markdown formatting or backticks.`;

  try {
    // First completion to identify relevant tables
    const tableIdentification = await simpleCompletion({
      behavior: `Return a raw JSON array of table names. Do not include any markdown formatting, backticks, or code blocks.`,
      prompt: tableIdentificationPrompt,
      maxTokens: 200,
      temperature: 0,
      organization: req.organization,
    });

    // Clean up any potential markdown formatting before parsing
    const cleanJson = tableIdentification
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^`/g, "")
      .trim();

    // Parse the identified tables
    const relevantTables = JSON.parse(cleanJson) as string[];

    // Step 2: Get schema information only for the relevant tables
    let schemaInfo = "";
    if (informationSchema) {
      for (const database of informationSchema.databases) {
        for (const schema of database.schemas) {
          for (const table of schema.tables) {
            const fullTableName = `${database.databaseName}.${schema.schemaName}.${table.tableName}`;

            // Check if this table is in our relevant tables list
            const isRelevant = relevantTables.some((relevantTable) => {
              if (relevantTable.includes("*")) {
                const pattern = new RegExp(
                  "^" + relevantTable.replace("*", ".*") + "$"
                );
                return pattern.test(fullTableName);
              }
              return relevantTable === fullTableName;
            });

            if (isRelevant) {
              const tableInfo = await getInformationSchemaTableById(
                req.organization.id,
                table.id
              );
              if (tableInfo && tableInfo.columns) {
                // Group columns by data type
                const columnsByType = tableInfo.columns.reduce((acc, col) => {
                  const type = col.dataType.toLowerCase();
                  if (!acc[type]) acc[type] = [];
                  acc[type].push(col.columnName);
                  return acc;
                }, {} as Record<string, string[]>);

                // Only include the most relevant column types (string, number, timestamp)
                const relevantTypes = [
                  "string",
                  "varchar",
                  "text",
                  "int",
                  "integer",
                  "number",
                  "float",
                  "double",
                  "decimal",
                  "timestamp",
                  "datetime",
                  "date",
                ];
                const filteredColumnsByType = Object.entries(columnsByType)
                  .filter(([type]) =>
                    relevantTypes.some((t) => type.includes(t))
                  )
                  .reduce((acc, [type, cols]) => {
                    acc[type] = cols;
                    return acc;
                  }, {} as Record<string, string[]>);

                // Format columns by type in a more concise way
                const columnsInfo = Object.entries(filteredColumnsByType)
                  .map(([type, columns]) => `${type}:${columns.join(",")}`)
                  .join("|");

                schemaInfo += `${fullTableName}(${columnsInfo})\n`;
              }
            }
          }
        }
      }
    }

    // Step 3: Generate the final SQL query with only the relevant schema information
    const sqlGenerationPrompt = `Generate ${datasourceType} SQL for: ${naturalLanguage}

Schema: ${schemaInfo}

Guidelines:
1. Use wildcards for intraday tables
2. Write efficient, readable queries
3. Use table aliases
4. Format with proper indentation
5. No markdown/backticks around query
6. For BigQuery: use backticks for ALL table names (e.g., \`project.dataset.table\`)
7. For MySQL: use backticks if needed
8. For PostgreSQL: use double quotes if needed
9. For SQL Server: use square brackets if needed

Generate ONLY the SQL query.`;

    const completion = await simpleCompletion({
      behavior: `Generate clean SQL for ${datasourceType}. Use exact column names. For BigQuery, use backticks for ALL table names.`,
      prompt: sqlGenerationPrompt,
      maxTokens: 200,
      temperature: 0,
      organization: req.organization,
    });

    // Clean up any potential markdown formatting
    const cleanSql = completion
      .trim()
      .replace(/^```sql\s*/i, "")
      .replace(/```\s*$/i, "")
      .replace(/^`/g, "")
      .trim();

    return res.json({
      sql: cleanSql,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to generate SQL query",
      error: error.message,
    });
  }
}
