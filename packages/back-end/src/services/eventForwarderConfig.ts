import { AES, enc } from "crypto-js";
import { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import {
  BigQueryEventForwarderConfigDraft,
  EventForwarderConfigDraft,
  EventForwarderSinkType,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  CONFLUENT_EVENT_FORWARDER_TOPIC_PREFIX,
  ENCRYPTION_KEY,
} from "back-end/src/util/secrets";

type SinkConfig = BigQueryEventForwarderConfigDraft | Record<string, string>;

const DEFAULT_BIGQUERY_EVENTS_TABLE = "gb_events";

function sanitizeKafkaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getTopicName(orgId: string): string {
  return sanitizeKafkaName(
    `${CONFLUENT_EVENT_FORWARDER_TOPIC_PREFIX}-${orgId}`,
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

export async function getEventForwarderConfigBySinkType(
  context: ReqContext,
  sinkType: EventForwarderSinkType,
): Promise<EventForwarderConfigInterface | null> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  return configs.find((config) => config.sinkType === sinkType) ?? null;
}

function getMergedProjects(
  existing: EventForwarderConfigInterface | null,
  datasource: Pick<DataSourceInterface, "projects">,
): string[] {
  return Array.from(
    new Set([...(existing?.projects ?? []), ...(datasource.projects ?? [])]),
  ).sort();
}

function buildBigQueryServiceAccountKey(
  params: BigQueryConnectionParams,
): string | null {
  if (!params.projectId || !params.clientEmail || !params.privateKey) {
    return null;
  }

  return JSON.stringify({
    type: "service_account",
    project_id: params.projectId,
    client_email: params.clientEmail,
    private_key: params.privateKey,
  });
}

function normalizeBigQueryDraft(
  draft: BigQueryEventForwarderConfigDraft,
  datasourceParams?: BigQueryConnectionParams,
  existing?: BigQueryEventForwarderConfigDraft | null,
): BigQueryEventForwarderConfigDraft {
  return {
    projectId:
      draft.projectId ||
      datasourceParams?.defaultProject ||
      datasourceParams?.projectId ||
      "",
    dataset: draft.dataset || datasourceParams?.defaultDataset || "",
    tableName: draft.tableName || DEFAULT_BIGQUERY_EVENTS_TABLE,
    serviceAccountKey:
      draft.serviceAccountKey ||
      existing?.serviceAccountKey ||
      buildBigQueryServiceAccountKey(
        datasourceParams || ({} as BigQueryConnectionParams),
      ) ||
      "",
  };
}

function normalizeDraft(
  draft: EventForwarderConfigDraft,
  datasourceParams?: BigQueryConnectionParams,
  existing?: EventForwarderConfigDraft | null,
): EventForwarderConfigDraft {
  if (draft.sinkType === "bigquery") {
    return {
      sinkType: "bigquery",
      config: normalizeBigQueryDraft(
        draft.config,
        datasourceParams,
        existing?.sinkType === "bigquery" ? existing.config : null,
      ),
    };
  }

  return draft;
}

export function toEventForwarderConfigDraft(
  config: EventForwarderConfigInterface | null,
): EventForwarderConfigDraft | null {
  if (!config) return null;

  if (config.sinkType === "bigquery") {
    const decrypted = decryptSinkConfig<BigQueryEventForwarderConfigDraft>(
      config.config,
    );
    return {
      sinkType: "bigquery",
      config: {
        ...decrypted,
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
  datasource: Pick<DataSourceInterface, "type">,
): Promise<EventForwarderConfigDraft | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) return null;

  const existing = await getEventForwarderConfigBySinkType(context, sinkType);
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
      ? getEventForwarderConfigBySinkType(context, sinkType)
      : null;
  }

  const existing = await getEventForwarderConfigBySinkType(context, sinkType);

  if (draft === null) {
    if (existing) {
      await context.models.eventForwarderConfigs.delete(existing);
    }
    return null;
  }

  const normalizedDraft = normalizeDraft(
    draft,
    datasourceParams,
    toEventForwarderConfigDraft(existing),
  );

  if (normalizedDraft.sinkType === "bigquery") {
    if (
      !normalizedDraft.config.projectId ||
      !normalizedDraft.config.dataset ||
      !normalizedDraft.config.tableName ||
      !normalizedDraft.config.serviceAccountKey
    ) {
      throw new Error(
        "BigQuery event forwarder requires project, dataset, table name, and service account credentials",
      );
    }
  }

  const projects = getMergedProjects(existing, datasource);

  if (!existing) {
    return await context.models.eventForwarderConfigs.create({
      projects,
      topic: getTopicName(datasource.organization),
      // Provisioning resolves the current registry schema id after the topic exists.
      schemaId: 0,
      sinkType: normalizedDraft.sinkType,
      config: encryptSinkConfig(normalizedDraft.config),
      status: "pending",
      connectorName: "",
      connectorId: "",
      lastProvisioningError: "",
    });
  }

  return await context.models.eventForwarderConfigs.update(existing, {
    projects,
    topic: existing.topic || getTopicName(datasource.organization),
    schemaId: existing.schemaId || 0,
    config: encryptSinkConfig(normalizedDraft.config),
    status: "pending",
    lastProvisioningError: "",
  });
}

export function decryptEventForwarderConfigModel<T extends SinkConfig>(
  config: EventForwarderConfigInterface,
): T {
  return decryptSinkConfig<T>(config.config);
}
