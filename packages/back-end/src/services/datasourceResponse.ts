import omit from "lodash/omit";
import {
  DataSourceInterface,
  DataSourceInterfaceWithParams,
} from "shared/types/datasource";
import { EventForwarderConfigWithMetadata } from "shared/types/event-forwarder";
import { getEventForwarderSinkTypeForDatasource } from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  getNonSensitiveParams,
  getSourceIntegrationObject,
} from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getEventForwarderMetadataForDatasource } from "back-end/src/services/eventForwarder/config";

export function buildDataSourceWithParams(
  integration: SourceIntegrationInterface,
  eventForwarderConfig?: EventForwarderConfigWithMetadata | null,
): DataSourceInterfaceWithParams {
  const datasource = integration.datasource;
  const otherFields = omit(datasource, "params");

  return {
    ...otherFields,
    projects: datasource.projects || [],
    params: getNonSensitiveParams(integration),
    properties: integration.getSourceProperties(),
    decryptionError: integration.decryptionError || false,
    eventForwarderConfig: eventForwarderConfig ?? null,
  };
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

  return buildDataSourceWithParams(integration, eventForwarderConfig);
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
