import { DataSourceInterface } from "shared/types/datasource";
import { EventForwarderConfigInterface } from "shared/validators";
import { usingFileConfig } from "back-end/src/init/config";
import { getEventForwarderSinkTypeForDatasource } from "back-end/src/services/eventForwarderConfig";
import { teardownBigQueryEventForwarderInfrastructureRemote } from "back-end/src/services/eventForwarderProvisioning";
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

  await deleteExisting();

  if (sinkType === "bigquery" || sinkType === "snowflake") {
    logger.info(
      {
        organizationId: context.org.id,
        eventForwarderConfigId: snapshot.eventForwarderConfigId,
      },
      "Event forwarder sync: invoking Confluent teardown via license server",
    );
    try {
      await teardownBigQueryEventForwarderInfrastructureRemote({
        context,
        snapshot: {
          organizationId: snapshot.organizationId,
          datasourceId: snapshot.datasourceId,
          sinkType: snapshot.sinkType,
          topic: snapshot.topic,
          connectorName: snapshot.connectorName,
          connectorId: snapshot.connectorId,
        },
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
        "Event forwarder teardown via license server failed after Mongo row was deleted",
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
              "Confluent connector and Kafka topics may still exist; use Confluent Cloud console or API with these names.",
          }),
        });
      } catch (auditErr) {
        logger.error(
          auditErr,
          "Failed to write audit log for event forwarder teardown failure",
        );
      }
      throw new Error(
        `Event forwarder Confluent teardown failed: ${message}. An audit entry was recorded with resource names for manual cleanup.`,
      );
    }
  } else {
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

export async function deleteEventForwarderConfigForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
  existing: EventForwarderConfigInterface,
): Promise<void> {
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
 * delete the Mongo row first, then tear down Confluent resources via the license server.
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

  const existing =
    await context.models.eventForwarderConfigs.dangerousGetByDatasourceIdBypassPermission(
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
    "Event forwarder sync after datasource delete: removing event forwarder row before license-server teardown",
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
