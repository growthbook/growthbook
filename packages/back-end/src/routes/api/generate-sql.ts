import { z } from "zod";
import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getContextFromReq } from "back-end/src/services/organizations";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import {
  hasExceededUsageQuota,
  simpleCompletion,
} from "back-end/src/services/openai";
import { DataSourceType } from "back-end/types/datasource";

const generateSqlSchema = z.object({
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
});

type GenerateSqlRequest = z.infer<typeof generateSqlSchema>;

const OPENAI_ENABLED = !!process.env.OPENAI_API_KEY;

const getBehaviorPrompt = (
  datasourceType: DataSourceType
) => `You are an expert SQL query generator. Your task is to convert natural language into SQL queries optimized for ${datasourceType}. 
You should:
1. Generate valid SQL syntax for ${datasourceType}
2. Use appropriate table and column names based on the context
3. Include helpful comments explaining the query
4. Format the SQL query for readability
5. Do NOT end the query with a semicolon as our query runner handles this
6. Only output the SQL query without any additional explanation`;

export const generateSql = async (
  req: AuthRequest<GenerateSqlRequest>,
  res: Response
) => {
  const { naturalLanguage, datasourceId, datasourceType } = req.body;
  const context = getContextFromReq(req);

  if (!context.org) {
    return res.status(400).json({
      error: "Organization not found",
    });
  }

  try {
    if (!OPENAI_ENABLED) {
      throw new Error("OpenAI integration is not enabled");
    }

    if (await hasExceededUsageQuota(context.org)) {
      return res.status(429).json({
        error: "Daily AI usage quota exceeded",
      });
    }

    // If a datasource is specified, get its schema to help with query generation
    let schema = null;
    if (datasourceId) {
      const datasource = await getDataSourceById(context, datasourceId);
      if (datasource) {
        schema = datasource.settings?.informationSchemaId;
      }
    }

    // Add schema information to the prompt if available
    const prompt = schema
      ? `Given this database schema:\n${schema}\n\nConvert this request to SQL: ${naturalLanguage}`
      : `Convert this request to SQL: ${naturalLanguage}`;

    const query = await simpleCompletion({
      behavior: getBehaviorPrompt(datasourceType),
      prompt,
      organization: context.org,
      temperature: 0.3, // Lower temperature for more deterministic SQL generation
    });

    res.json({
      query,
      naturalLanguage,
      datasourceType,
    });
  } catch (e) {
    res.status(400).json({
      error: e.message,
    });
  }
};
