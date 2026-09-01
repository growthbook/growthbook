import {
  getPipelineValidationCreateTableQuery,
  getPipelineValidationDropTableQuery,
} from "shared/enterprise";
import {
  BigQueryEventForwarderStoredConfig,
  EventForwarderConfigDraft,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import {
  EventForwarderAccessTestResponse,
  EventForwarderConfigInterface,
} from "shared/validators";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourcePipelineSettings,
} from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  EventForwarderDatasourceParams,
  getEventForwarderDatasourceParams,
} from "shared/util";
import { UNITS_TABLE_PREFIX } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import {
  encryptParams,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import {
  buildNormalizedEventForwarderSinkPayloadForTest,
  getBigQueryEventForwarderProjectId,
} from "back-end/src/services/eventForwarder/config";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

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
    };

type ServiceAccountKey = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

export function getEventForwarderWriteAccessFailedResponse(
  message: string,
): EventForwarderAccessTestResponse {
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

function writeAccessSuccess(): EventForwarderAccessTestResponse {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Event Forwarder service account key is not valid JSON.");
  }
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
  switch (input.sinkType) {
    case "bigquery": {
      const projectId = getBigQueryEventForwarderProjectId(
        input.config,
        input.params,
      );
      return integration.generateTablePath(
        tableName,
        input.config.dataset.trim(),
        projectId,
        true,
      );
    }
    case "snowflake":
      return integration.generateTablePath(
        tableName,
        input.config.schema.trim(),
        input.config.database.trim(),
        true,
      );
    default:
      throw new Error(
        "Unsupported event forwarder sink type for write access test",
      );
  }
}

function getProbeParams(
  input: EventForwarderWriteAccessInput,
): DataSourceParams {
  switch (input.sinkType) {
    case "bigquery":
      return getBigQueryProbeParams(
        input.params,
        input.config.serviceAccountKey,
      );
    case "snowflake":
      return input.params;
    default:
      throw new Error(
        "Unsupported event forwarder sink type for write access test",
      );
  }
}

async function runWriteAccessProbe({
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
    return getEventForwarderWriteAccessFailedResponse(getErrorMessage(error));
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
          : `cleanup failed: ${dropError}`;
        logger.warn(
          error,
          `Event Forwarder write access cleanup failed for ${fullTestTablePath}`,
        );
      }
    }
  }

  if (failure) {
    return getEventForwarderWriteAccessFailedResponse(failure);
  }
  return writeAccessSuccess();
}

export async function testEventForwarderWriteAccess(
  context: ReqContext,
  input: EventForwarderWriteAccessInput,
): Promise<EventForwarderAccessTestResponse> {
  const params = getProbeParams(input);
  const datasource = getProbeDatasource({
    datasource: input.datasource,
    params,
  });

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) {
    return getEventForwarderWriteAccessFailedResponse(
      "This data source does not support Event Forwarder testing.",
    );
  }

  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const testTableName = `${UNITS_TABLE_PREFIX}_event_forwarder_validation_${randomSuffix}`;
  const fullTestTablePath = getProbeTablePath({
    integration,
    tableName: testTableName,
    input,
  });

  return runWriteAccessProbe({
    integration,
    fullTestTablePath,
  });
}

export function buildEventForwarderAccessTestDatasource({
  context,
  type,
  params,
  projects,
}: {
  context: ReqContext;
  type: "bigquery" | "snowflake";
  params: DataSourceParams;
  projects?: string[];
}): DataSourceInterface {
  return {
    id: "event-forwarder-access-test",
    name: "Event Forwarder Access Test",
    description: "",
    organization: context.org.id,
    dateCreated: null,
    dateUpdated: null,
    params: encryptParams(params),
    projects,
    settings: {},
    type,
  } as DataSourceInterface;
}

async function testEventForwarderWriteAccessForSink(
  context: ReqContext,
  args: {
    sinkType: EventForwarderConfigDraft["sinkType"];
    datasource: DataSourceInterface;
    datasourceParams: EventForwarderDatasourceParams;
    normalized:
      | BigQueryEventForwarderStoredConfig
      | SnowflakeEventForwarderStoredConfig;
  },
): Promise<EventForwarderAccessTestResponse> {
  switch (args.sinkType) {
    case "bigquery":
      return testEventForwarderWriteAccess(context, {
        sinkType: "bigquery",
        datasource: args.datasource,
        params: args.datasourceParams as BigQueryConnectionParams,
        config: args.normalized as BigQueryEventForwarderStoredConfig,
      });
    case "snowflake":
      return testEventForwarderWriteAccess(context, {
        sinkType: "snowflake",
        datasource: args.datasource,
        params: args.datasourceParams as SnowflakeConnectionParams,
        config: args.normalized as SnowflakeEventForwarderStoredConfig,
      });
    default:
      throw new Error(
        `Unsupported event forwarder sink type for access test: ${String(args.sinkType)}`,
      );
  }
}

export async function runEventForwarderAccessTest(
  context: ReqContext,
  args: {
    datasource: DataSourceInterface;
    params: DataSourceParams;
    draft: EventForwarderConfigDraft;
    existingModel: EventForwarderConfigInterface | null;
  },
): Promise<EventForwarderAccessTestResponse> {
  try {
    const datasourceParams = getEventForwarderDatasourceParams(
      args.datasource.type,
      args.params,
    );
    const normalized = buildNormalizedEventForwarderSinkPayloadForTest(
      args.draft,
      datasourceParams,
      args.existingModel,
    );

    return await testEventForwarderWriteAccessForSink(context, {
      sinkType: args.draft.sinkType,
      datasource: args.datasource,
      datasourceParams,
      normalized,
    });
  } catch (error) {
    return getEventForwarderWriteAccessFailedResponse(getErrorMessage(error));
  }
}

export function assertEventForwarderWriteAccessResult(
  result: Awaited<ReturnType<typeof testEventForwarderWriteAccess>>,
): void {
  const sinkWrite = result.results.sinkWrite;
  if (sinkWrite.result !== "success") {
    throw new Error(
      sinkWrite.resultMessage ||
        "Event Forwarder write access validation failed",
    );
  }
}
