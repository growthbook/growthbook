import {
  getPipelineValidationCreateTableQuery,
  getPipelineValidationDropTableQuery,
} from "shared/enterprise";
import { EventForwarderAccessTestResponse } from "shared/validators";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { UNITS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ReqContext } from "back-end/types/request";
import {
  encryptParams,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";

type EventForwarderWriteAccessInput =
  | {
      sinkType: "bigquery";
      datasource: DataSourceInterface;
      params: BigQueryConnectionParams;
      config: BigQueryEventForwarderStoredConfig;
    }
  | {
      sinkType: "snowflake";
      datasource: DataSourceInterface;
      params: SnowflakeConnectionParams;
      config: SnowflakeEventForwarderStoredConfig;
    }
  | {
      sinkType: "databricks";
      datasource: DataSourceInterface;
      params: DatabricksConnectionParams;
      config: Record<string, string>;
    };

type ServiceAccountKey = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function failed(message: string): EventForwarderAccessTestResponse {
  return {
    status: 200,
    results: {
      sinkWrite: {
        result: "failed",
        resultMessage: message,
      },
    },
  };
}

function success(): EventForwarderAccessTestResponse {
  return {
    status: 200,
    results: {
      sinkWrite: {
        result: "success",
      },
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBigQueryServiceAccountKey(raw: string): ServiceAccountKey | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Event Forwarder service account key is not valid JSON.");
  }

  return parsed as ServiceAccountKey;
}

function getBigQueryProbeParams(
  params: BigQueryConnectionParams,
  serviceAccountKeyJson: string | undefined,
): BigQueryConnectionParams {
  const serviceAccountKey = parseBigQueryServiceAccountKey(
    serviceAccountKeyJson || "",
  );
  if (!serviceAccountKey) return params;

  return {
    ...params,
    authType: "json",
    projectId: serviceAccountKey.project_id || params.projectId,
    defaultProject:
      params.defaultProject ||
      serviceAccountKey.project_id ||
      params.projectId ||
      "",
    clientEmail: serviceAccountKey.client_email || params.clientEmail,
    privateKey: serviceAccountKey.private_key || params.privateKey,
    serviceAccountJson: serviceAccountKeyJson,
  };
}

function getProbeDatasource({
  datasource,
  params,
}: {
  datasource: DataSourceInterface;
  params: DataSourceParams;
}): DataSourceInterface {
  const pipelineSettings: DataSourcePipelineSettings = {
    allowWriting: true,
    mode: "ephemeral",
    writeDataset: "",
    unitsTableRetentionHours: 1,
    unitsTableDeletion: true,
  };

  return {
    ...datasource,
    params: encryptParams(params),
    settings: {
      ...datasource.settings,
      pipelineSettings,
    },
  };
}

function getProbeTablePath({
  integration,
  tableName,
  input,
}: {
  integration: SqlIntegration;
  tableName: string;
  input: EventForwarderWriteAccessInput;
}): string {
  if (input.sinkType === "bigquery") {
    const projectId =
      input.params.defaultProject?.trim() || input.params.projectId?.trim();
    return integration.generateTablePath(
      tableName,
      input.config.dataset.trim(),
      projectId,
      true,
    );
  }

  if (input.sinkType === "snowflake") {
    return integration.generateTablePath(
      tableName,
      input.config.schema.trim(),
      input.config.database.trim(),
      true,
    );
  }

  return integration.generateTablePath(
    tableName,
    undefined,
    input.params.catalog,
    false,
  );
}

async function runProbe({
  integration,
  fullTestTablePath,
}: {
  integration: SqlIntegration;
  fullTestTablePath: string;
}): Promise<EventForwarderAccessTestResponse> {
  let created = false;
  let failure: string | null = null;

  try {
    await integration.runTestQuery(
      getPipelineValidationCreateTableQuery({
        tableFullName: fullTestTablePath,
        integration,
      }),
      undefined,
      "pipelineValidation",
    );
    created = true;
  } catch (error) {
    return failed(getErrorMessage(error));
  } finally {
    if (created) {
      try {
        await integration.runTestQuery(
          getPipelineValidationDropTableQuery({
            tableFullName: fullTestTablePath,
            integration,
          }),
          undefined,
          "pipelineValidation",
        );
      } catch (error) {
        const dropError = getErrorMessage(error);
        failure = failure
          ? `${failure}; cleanup failed: ${dropError}`
          : `Cleanup failed: ${dropError}`;
      }
    }
  }

  return failure ? failed(failure) : success();
}

export async function testEventForwarderWriteAccess(
  context: ReqContext,
  input: EventForwarderWriteAccessInput,
): Promise<EventForwarderAccessTestResponse> {
  const params =
    input.sinkType === "bigquery"
      ? getBigQueryProbeParams(input.params, input.config.serviceAccountKey)
      : input.params;
  const datasource = getProbeDatasource({
    datasource: input.datasource,
    params,
  });

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) {
    return failed("This data source does not support Event Forwarder testing.");
  }

  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const testTableName = `${UNITS_TABLE_PREFIX}_event_forwarder_validation_${randomSuffix}`;
  const fullTestTablePath = getProbeTablePath({
    integration,
    tableName: testTableName,
    input,
  });

  return runProbe({
    integration,
    fullTestTablePath,
  });
}
