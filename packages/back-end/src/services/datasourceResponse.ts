import omit from "lodash/omit";
import {
  DataSourceInterface,
  DataSourceInterfaceWithParams,
  DataSourceType,
} from "shared/types/datasource";
import { EventForwarderConfigWithMetadata } from "shared/types/event-forwarder";
import {
  getEventForwarderSinkTypeForDatasource,
  getReadableExposureQueries,
} from "shared/util";
import type { DataSourceParamsForType } from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  getNonSensitiveParams,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getEventForwarderMetadataForDatasource } from "back-end/src/services/eventForwarder/config";

type DataSourceByType = {
  [DataSource in DataSourceInterface as DataSource["type"]]: DataSource;
};

type DataSourceWithParamsByType = {
  [DataSource in DataSourceInterfaceWithParams as DataSource["type"]]: DataSource;
};

type DataSourceResponse<T extends DataSourceType> = Omit<
  DataSourceByType[T],
  "params"
> & {
  params: DataSourceParamsForType<T>;
  properties: ReturnType<SourceIntegrationInterface<T>["getSourceProperties"]>;
  decryptionError: boolean;
  eventForwarderConfig: EventForwarderConfigWithMetadata | null;
};

/** The settings as the user is shown them: without unreadable assignment queries. */
export function withReadableExposureQueries(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
): DataSourceInterface["settings"] {
  const { settings } = datasource;
  if (!settings?.queries?.exposure) return settings;
  return {
    ...settings,
    queries: {
      ...settings.queries,
      exposure: getReadableExposureQueries(
        settings.queries.exposure,
        datasource.projects,
        context.permissions.canReadMultiProjectResource,
      ),
    },
  };
}

function buildDataSourceWithParams<T extends DataSourceType>(
  context: ReqContext,
  integration: SourceIntegrationInterface<T>,
  eventForwarderConfig?: EventForwarderConfigWithMetadata | null,
): DataSourceWithParamsByType[T];
function buildDataSourceWithParams(
  context: ReqContext,
  integration: SourceIntegrationInterface,
  eventForwarderConfig?: EventForwarderConfigWithMetadata | null,
): unknown {
  const datasource = integration.datasource;
  const otherFields = omit(datasource, "params");

  return {
    ...otherFields,
    settings: withReadableExposureQueries(context, datasource),
    projects: datasource.projects || [],
    params: getNonSensitiveParams(integration),
    properties: integration.getSourceProperties(),
    decryptionError: integration.decryptionError || false,
    eventForwarderConfig: eventForwarderConfig ?? null,
  } satisfies DataSourceResponse<DataSourceType>;
}

export async function getDataSourceWithParams(
  context: ReqContext,
  integration: SourceIntegrationInterface,
): Promise<DataSourceInterfaceWithParams> {
  const eventForwarderConfig = getEventForwarderSinkTypeForDatasource(
    integration.datasource,
  )
    ? await getEventForwarderMetadataForDatasource(
        context,
        integration.datasource,
      )
    : null;

  return buildDataSourceWithParams(context, integration, eventForwarderConfig);
}

export async function getDataSourcesWithParams(
  context: ReqContext,
  datasources: DataSourceInterface[],
): Promise<DataSourceInterfaceWithParams[]> {
  return Promise.all(
    datasources.map((datasource) =>
      getDataSourceWithParams(
        context,
        getSourceIntegrationObject(context, datasource),
      ),
    ),
  );
}
