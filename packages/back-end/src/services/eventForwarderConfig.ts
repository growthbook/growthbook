import { AES, enc } from "crypto-js";
import { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import {
  BigQueryEventForwarderConfigDraft,
  BigQueryEventForwarderStoredConfig,
  EventForwarderConfigDraft,
  EventForwarderSinkType,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
  normalizeBigQueryTableNameForEventForwarder,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  CONFLUENT_EVENT_FORWARDER_TOPIC_PREFIX,
  ENCRYPTION_KEY,
} from "back-end/src/util/secrets";

type SinkConfig = BigQueryEventForwarderStoredConfig | Record<string, string>;

function sanitizeKafkaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Kafka topic pinned at create; includes datasource so topics are unique per forwarder. */
export function getEventForwarderTopicName(
  orgId: string,
  datasourceId: string,
): string {
  return sanitizeKafkaName(
    `${CONFLUENT_EVENT_FORWARDER_TOPIC_PREFIX}-${orgId}-${datasourceId}`,
  );
}

function encryptSinkConfig(config: SinkConfig): string {
  return AES.encrypt(JSON.stringify(config), ENCRYPTION_KEY).toString();
}

function decryptSinkConfig<T extends SinkConfig>(encrypted: string): T {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

export function getEventForwarderSinkTypeForDatasource(
  datasource: Pick<DataSourceInterface, "type">,
): EventForwarderSinkType | null {
  switch (datasource.type) {
    case "bigquery":
      return "bigquery";
    case "snowflake":
      return "snowflake";
    case "databricks":
      return "databricks";
    default:
      return null;
  }
}

export async function getEventForwarderConfigForDatasource(
  context: ReqContext,
  datasourceId: string,
): Promise<EventForwarderConfigInterface | null> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  return configs.find((config) => config.datasourceId === datasourceId) ?? null;
}

/**
 * Builds the same JSON shape as a GCP-downloaded service account key (see
 * `keyfile` in Confluent’s BigQuery Storage Sink docs). This is not Confluent’s
 * optional “OAuth 2.0” **connector** auth mode (that UI-only flow uses
 * `oauth.client.id` / refresh tokens). Service account keys always include
 * `auth_uri` / `token_uri`; Google’s client libraries use them for the service
 * account JWT flow, not for interactive OAuth.
 */
function buildBigQueryServiceAccountKey(
  params: BigQueryConnectionParams,
): string | null {
  if (!params.projectId || !params.clientEmail || !params.privateKey) {
    return null;
  }

  const clientEmail = params.clientEmail;
  return JSON.stringify({
    type: "service_account",
    project_id: params.projectId,
    private_key_id: "",
    private_key: params.privateKey,
    client_email: clientEmail,
    client_id: "",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(
      clientEmail,
    )}`,
  });
}

function buildBigQueryStoredConfigFromDraft(
  draft: BigQueryEventForwarderConfigDraft,
  datasourceParams: BigQueryConnectionParams | undefined,
  existingModel: EventForwarderConfigInterface | null,
): BigQueryEventForwarderStoredConfig {
  const existingStored =
    existingModel?.sinkType === "bigquery"
      ? decryptSinkConfig<BigQueryEventForwarderStoredConfig>(
          existingModel.config,
        )
      : null;

  const dataset = datasourceParams?.defaultDataset?.trim() || "";

  const rawTableName =
    draft.tableName?.trim() ||
    existingStored?.tableName?.trim() ||
    DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME;

  const tableName = normalizeBigQueryTableNameForEventForwarder(rawTableName);

  const serviceAccountKey =
    draft.serviceAccountKey?.trim() ||
    existingStored?.serviceAccountKey ||
    datasourceParams?.serviceAccountJson?.trim() ||
    buildBigQueryServiceAccountKey(
      datasourceParams || ({} as BigQueryConnectionParams),
    ) ||
    "";

  return {
    dataset,
    tableName,
    serviceAccountKey,
  };
}

function buildNormalizedSinkPayload(
  draft: EventForwarderConfigDraft,
  datasourceParams: BigQueryConnectionParams | undefined,
  existingModel: EventForwarderConfigInterface | null,
): SinkConfig {
  if (draft.sinkType === "bigquery") {
    return buildBigQueryStoredConfigFromDraft(
      draft.config,
      datasourceParams,
      existingModel,
    );
  }

  return draft.config as Record<string, string>;
}

export function toEventForwarderConfigDraft(
  config: EventForwarderConfigInterface | null,
): EventForwarderConfigDraft | null {
  if (!config) return null;

  if (config.sinkType === "bigquery") {
    const decrypted = decryptSinkConfig<
      BigQueryEventForwarderStoredConfig & { projectId?: string }
    >(config.config);
    const { dataset: _dataset, projectId: _removed, ...rest } = decrypted;
    return {
      sinkType: "bigquery",
      config: {
        tableName:
          rest.tableName || DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
        serviceAccountKey: "",
      },
    };
  }

  return {
    sinkType: config.sinkType,
    config: decryptSinkConfig<Record<string, string>>(config.config),
  };
}

export async function getEventForwarderConfigDraftForDatasource(
  context: ReqContext,
  datasource: Pick<DataSourceInterface, "type" | "id">,
): Promise<EventForwarderConfigDraft | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) return null;

  const existing = await getEventForwarderConfigForDatasource(
    context,
    datasource.id,
  );
  return toEventForwarderConfigDraft(existing);
}

export async function syncEventForwarderConfigFromDatasource({
  context,
  datasource,
  draft,
  datasourceParams,
}: {
  context: ReqContext;
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >;
  draft?: EventForwarderConfigDraft | null;
  datasourceParams?: BigQueryConnectionParams;
}): Promise<EventForwarderConfigInterface | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);

  if (!sinkType || draft === undefined) {
    return sinkType
      ? getEventForwarderConfigForDatasource(context, datasource.id)
      : null;
  }

  const existing = await getEventForwarderConfigForDatasource(
    context,
    datasource.id,
  );

  if (draft === null) {
    if (existing) {
      await context.models.eventForwarderConfigs.delete(existing);
    }
    return null;
  }

  const normalizedPayload = buildNormalizedSinkPayload(
    draft,
    datasourceParams,
    existing,
  );

  if (draft.sinkType === "bigquery") {
    const bqProject =
      datasourceParams?.defaultProject?.trim() ||
      datasourceParams?.projectId?.trim() ||
      "";
    const defaultDataset = datasourceParams?.defaultDataset?.trim() || "";
    const bq = normalizedPayload as BigQueryEventForwarderStoredConfig;
    if (
      !bqProject ||
      !defaultDataset ||
      !bq.tableName?.trim() ||
      !bq.serviceAccountKey
    ) {
      throw new Error(
        "BigQuery event forwarder requires connector project (BigQuery Project ID), default dataset, table name, and service account credentials",
      );
    }
  }

  const projects = [...(datasource.projects ?? [])].sort();

  if (!existing) {
    return await context.models.eventForwarderConfigs.create({
      datasourceId: datasource.id,
      projects,
      topic: getEventForwarderTopicName(datasource.organization, datasource.id),
      // Provisioning resolves the current registry schema id after the topic exists.
      schemaId: 0,
      sinkType: draft.sinkType,
      config: encryptSinkConfig(normalizedPayload),
      status: "pending",
      connectorName: "",
      connectorId: "",
      lastProvisioningError: "",
    });
  }

  return await context.models.eventForwarderConfigs.update(existing, {
    datasourceId: existing.datasourceId || datasource.id,
    projects,
    topic:
      existing.topic ||
      getEventForwarderTopicName(datasource.organization, datasource.id),
    schemaId: existing.schemaId || 0,
    config: encryptSinkConfig(normalizedPayload),
    status: "pending",
    lastProvisioningError: "",
  });
}

export function decryptEventForwarderConfigModel<T extends SinkConfig>(
  config: EventForwarderConfigInterface,
): T {
  return decryptSinkConfig<T>(config.config);
}
