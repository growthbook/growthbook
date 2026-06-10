import { DataSourceInterface } from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { EventForwarderDatasourceParams } from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  getEventForwarderForDatasource,
  isEventForwarderDraftUnchanged,
  refreshEventForwarderConfigCredentials,
  syncEventForwarderConfigFromDatasource,
} from "back-end/src/services/eventForwarderConfig";
import {
  provisionEventForwarderThroughLicenseServer,
  updateEventForwarderCredentialsThroughLicenseServer,
} from "back-end/src/services/eventForwarderProvisioning";

export async function syncEventForwarderAfterDatasourceUpdate({
  context,
  datasource,
  eventForwarderConfig,
  datasourceParams,
  didUpdateDatasourceParams,
}: {
  context: ReqContext;
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >;
  eventForwarderConfig?: EventForwarderConfigDraft | null;
  datasourceParams: EventForwarderDatasourceParams;
  didUpdateDatasourceParams: boolean;
}): Promise<void> {
  if (eventForwarderConfig === null) {
    throw new Error(
      "Cannot remove an Event Forwarder via datasource update. Use DELETE /datasource/:id/event-forwarder instead.",
    );
  }

  if (eventForwarderConfig !== undefined) {
    const existing = await getEventForwarderForDatasource(
      context,
      datasource.id,
    );

    if (isEventForwarderDraftUnchanged(eventForwarderConfig, existing)) {
      return;
    }

    const syncedEventForwarderConfig =
      await syncEventForwarderConfigFromDatasource({
        context,
        datasource,
        draft: eventForwarderConfig,
        datasourceParams,
      });
    await provisionEventForwarderThroughLicenseServer(
      context,
      syncedEventForwarderConfig,
      datasourceParams,
      { restartAfterProvision: !!existing?.connectorName?.trim() },
    );
    return;
  }

  if (!didUpdateDatasourceParams) {
    return;
  }

  const refreshedConfig = await refreshEventForwarderConfigCredentials(
    context,
    datasource,
    datasourceParams,
  );
  await updateEventForwarderCredentialsThroughLicenseServer(
    context,
    refreshedConfig,
    datasourceParams,
  );
}
