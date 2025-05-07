import { Request, Response } from "express";
import { z } from "zod";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  hasExceededUsageQuota,
  simpleCompletion,
} from "back-end/src/services/openai";
import { ApiRequestLocals } from "back-end/types/api";
import { InformationSchemaInterface } from "back-end/src/types/Integration";

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
  console.log("made it to the generateSql function");
  const { naturalLanguage, datasourceId, datasourceType, informationSchema } =
    req.body;

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

  // If datasourceId is provided, get the schema
  let schema = "";
  if (datasourceId) {
    const datasource = await getDataSourceById(
      datasourceId,
      req.organization.id
    );
    if (!datasource) {
      return res.status(404).json({
        message: "Data source not found",
      });
    }
    if (datasource.settings.informationSchemaId) {
      schema = datasource.settings.informationSchemaId;
    }
  }

  // Construct schema information from informationSchema if provided
  let schemaInfo = "";
  if (informationSchema) {
    schemaInfo = "Available databases and tables:\n";
    informationSchema.databases.forEach(
      (database: InformationSchema["databases"][0]) => {
        schemaInfo += `Database: ${database.databaseName}\n`;
        database.schemas.forEach(
          (schema: InformationSchema["databases"][0]["schemas"][0]) => {
            schemaInfo += `  Schema: ${schema.schemaName}\n`;
            schema.tables.forEach(
              (
                table: InformationSchema["databases"][0]["schemas"][0]["tables"][0]
              ) => {
                schemaInfo += `    Table: ${table.tableName}\n`;
                if (table.columns) {
                  table.columns.forEach(
                    (column: { columnName: string; dataType: string }) => {
                      schemaInfo += `      Column: ${column.columnName} (${column.dataType})\n`;
                    }
                  );
                }
              }
            );
          }
        );
      }
    );
  }

  // Generate the SQL query
  const prompt = `You are a SQL query generator. Generate a SQL query for ${datasourceType} based on the following request: ${naturalLanguage}${
    schema ? `\n\nHere is the database schema:\n${schema}` : ""
  }${
    schemaInfo
      ? `\n\nHere is the available schema information:\n${schemaInfo}`
      : ""
  }

Follow these guidelines when generating the SQL:
1. For intraday tables, prefer using wildcards (e.g., 'events_*') instead of multiple joins
2. Write efficient queries while maintaining readability
3. Use appropriate indexes and table structures when available
4. Avoid unnecessary subqueries or CTEs unless they significantly improve readability
5. Use table aliases for better readability
6. Format the query with proper indentation and line breaks
7. Do not include any markdown formatting or backticks around the entire query
8. Do not include a semicolon at the end of the query
9. For table names:
   - For BigQuery: ALWAYS use backticks (\`) around table names and ALWAYS close them (e.g., \`project.dataset.table\`, \`project.dataset.events_*\`)
   - Use backticks for table names in MySQL/MariaDB if they contain special characters
   - Use double quotes for table names in PostgreSQL if they contain special characters
   - Use square brackets for table names in SQL Server if they contain special characters
   - For other databases, follow their specific identifier quoting rules

IMPORTANT: For BigQuery, ensure that every table name is properly enclosed in backticks, including wildcard patterns. For example:
- Correct: FROM \`project.dataset.events_*\`
- Incorrect: FROM \`project.dataset.events_*

Generate ONLY the SQL query, without any explanations, comments, or markdown formatting.`;

  try {
    const completion = await simpleCompletion({
      behavior: `You are a SQL query generator specialized in ${datasourceType}. Your task is to generate clean, efficient SQL queries that follow best practices for the specific database type. For BigQuery, you MUST ensure that every table name is properly enclosed in backticks, including wildcard patterns. Never include markdown formatting or backticks around the entire query.`,
      prompt,
      maxTokens: 500,
      temperature: 0,
      organization: req.organization,
    });

    // Clean up any potential markdown formatting
    const cleanSql = completion
      .trim()
      .replace(/^```sql\s*/i, "") // Remove opening ```sql
      .replace(/```\s*$/i, "") // Remove closing ```
      .replace(/^`/g, "") // Remove any remaining backticks at start
      // .replace(/`$/g, "") // Remove any remaining backticks at end
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
