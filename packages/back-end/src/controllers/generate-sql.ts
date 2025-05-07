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
  }\n\nGenerate ONLY the SQL query, without any explanations or comments. Do not include a semicolon at the end of the query.`;

  try {
    const completion = await simpleCompletion({
      behavior:
        "You are a SQL query generator. Be precise and follow the database schema if provided.",
      prompt,
      maxTokens: 500,
      temperature: 0,
      organization: req.organization,
    });

    return res.json({
      sql: completion.trim(),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to generate SQL query",
      error: error.message,
    });
  }
}
