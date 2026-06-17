import { DataSourceInterface } from "shared/types/datasource";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  EventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
} from "shared/util";
import { usingFileConfig } from "back-end/src/init/config";
import {
  getEventForwarderForDatasource,
  isEventForwarderDraftUnchanged,
  refreshEventForwarderConfigCredentials,
  syncEventForwarderConfigFromDatasource,
} from "back-end/src/services/eventForwarder/config";
import {
  provisionEventForwarderThroughLicenseServer,
  teardownEventForwarderInfrastructureRemote,
  updateEventForwarderCredentialsThroughLicenseServer,
} from "back-end/src/services/eventForwarder/connector";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

async function deleteEventForwarderAndTeardown({
  context,
  datasource,
  existing,
  deleteExisting,
}: {
  context: ReqContext | ApiReqContext;
  datasource: DataSourceInterface;
  existing: EventForwarderConfigInterface;
  deleteExisting: () => Promise<void>;
}): Promise<void> {
  const datasourceSinkType = getEventForwarderSinkTypeForDatasource(datasource);
  const sinkType = datasourceSinkType ?? existing.sinkType;
  if (!datasourceSinkType) {
    logger.warn(
      {
        organizationId: context.org.id,
        datasourceId: datasource.id,
        datasourceType: datasource.type,
        sinkType,
        eventForwarderConfigId: existing.id,
      },
      "Event forwarder sync: datasource type has no event-forwarder sink; falling back to config sink type before deletion",
    );
  }

  const snapshot = {
    organizationId: context.org.id,
    datasourceId: datasource.id,
    sinkType,
    topic: existing.topic?.trim() || undefined,
    connectorName: existing.connectorName?.trim() || undefined,
    connectorId: existing.connectorId?.trim() || undefined,
    eventForwarderConfigId: existing.id,
  };

  switch (sinkType) {
    case "bigquery":
    case "snowflake": {
      logger.info(
        {
          organizationId: context.org.id,
          eventForwarderConfigId: snapshot.eventForwarderConfigId,
        },
        "Event forwarder sync: invoking Confluent teardown via license server",
      );
      try {
        await teardownEventForwarderInfrastructureRemote({
          organizationId: snapshot.organizationId,
          datasourceId: snapshot.datasourceId,
          sinkType: snapshot.sinkType,
          topic: snapshot.topic,
          connectorName: snapshot.connectorName,
          connectorId: snapshot.connectorId,
        });
        logger.info(
          {
            organizationId: context.org.id,
            eventForwarderConfigId: snapshot.eventForwarderConfigId,
          },
          "Event forwarder sync: license-server teardown completed",
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown teardown error";
        logger.error(
          {
            err: error,
            organizationId: context.org.id,
            eventForwarderConfigId: snapshot.eventForwarderConfigId,
            snapshot,
          },
          "Event forwarder teardown via license server failed; Mongo row retained for retry",
        );
        try {
          await context.auditLog({
            entity: {
              object: "eventForwarderConfig",
              id: snapshot.eventForwarderConfigId,
              name: "",
            },
            event: "eventForwarderConfig.teardownFailure",
            details: JSON.stringify({
              error: message,
              datasourceId: snapshot.datasourceId,
              topic: snapshot.topic,
              connectorName: snapshot.connectorName,
              connectorId: snapshot.connectorId,
              manualHint:
                "Event forwarder config was not removed. Retry disconnect from GrowthBook, or remove Confluent connector and Kafka topics manually using the names above.",
            }),
          });
        } catch (auditErr) {
          logger.error(
            auditErr,
            "Failed to write audit log for event forwarder teardown failure",
          );
        }
        throw new Error(
          `Event forwarder Confluent teardown failed: ${message}. Config was not removed — retry disconnect or clean up manually in Confluent.`,
        );
      }
      break;
    }
    default: {
      logger.info(
        {
          organizationId: context.org.id,
          sinkType,
          eventForwarderConfigId: snapshot.eventForwarderConfigId,
        },
        "Event forwarder sync: skipping Confluent teardown for sink type",
      );
    }
  }

  await deleteExisting();
}

export async function deleteEventForwarderConfigForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
  existing: EventForwarderConfigInterface,
): Promise<void> {
  // Does not delete the Events fact table, exposure queries, or feature usage
  // queries — those remain on the datasource until it is deleted.
  await deleteEventForwarderAndTeardown({
    context,
    datasource,
    existing,
    deleteExisting: async () => {
      await context.models.eventForwarderConfigs.delete(existing);
    },
  });
}

/**
 * After removing a datasource: if a per-datasource event forwarder row exists for this id,
 * tear down Confluent resources via the license server first, then delete the Mongo row.
 */
export async function syncEventForwarderAfterDatasourceDeleted(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  logger.info(
    {
      organizationId: context.org.id,
      datasourceId: datasource.id,
      datasourceType: datasource.type,
    },
    "Event forwarder sync after datasource delete: starting",
  );

  if (usingFileConfig()) {
    logger.info(
      {
        organizationId: context.org.id,
        datasourceId: datasource.id,
      },
      "Event forwarder sync after datasource delete: skipped (config.yml / file config mode)",
    );
    return;
  }

  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) {
    logger.info(
      {
        organizationId: context.org.id,
        datasourceId: datasource.id,
        datasourceType: datasource.type,
      },
      "Event forwarder sync after datasource delete: datasource type has no event-forwarder sink (no Confluent row to reconcile)",
    );
    return;
  }

  // Bypass read permission — datasource delete is authorized separately; we must
  // still find the row to tear down Confluent resources (see model JSDoc).
  const existing =
    await context.models.eventForwarderConfigs.getByDatasourceIdForDatasourceCascade(
      datasource.id,
    );
  if (!existing) {
    logger.info(
      {
        organizationId: context.org.id,
        datasourceId: datasource.id,
        sinkType,
      },
      "Event forwarder sync after datasource delete: no event forwarder config for this datasource — skipping teardown and cascade delete",
    );
    return;
  }

  logger.info(
    {
      organizationId: context.org.id,
      datasourceId: datasource.id,
      sinkType,
      eventForwarderConfigId: existing.id,
    },
    "Event forwarder sync after datasource delete: tearing down Confluent resources before removing event forwarder row",
  );

  await deleteEventForwarderAndTeardown({
    context,
    datasource,
    existing,
    deleteExisting: async () => {
      await context.models.eventForwarderConfigs.deleteForDatasourceCascade(
        existing,
      );
    },
  });
}

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
