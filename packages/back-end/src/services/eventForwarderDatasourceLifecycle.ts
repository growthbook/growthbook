import { DataSourceInterface } from "shared/types/datasource";
import { usingFileConfig } from "back-end/src/init/config";
import { getEventForwarderSinkTypeForDatasource } from "back-end/src/services/eventForwarderConfig";
import { teardownBigQueryEventForwarderInfrastructure } from "back-end/src/services/eventForwarderProvisioning";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

/**
 * After removing a datasource: if a per-datasource event forwarder row exists for this id,
 * tear down BigQuery Confluent resources when applicable and delete that row.
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
    "Event forwarder sync after datasource delete: removing event forwarder row for this datasource",
  );

  if (sinkType === "bigquery") {
    logger.info(
      {
        organizationId: context.org.id,
        eventForwarderConfigId: existing.id,
      },
      "Event forwarder sync: invoking BigQuery Confluent teardown (connector + Kafka topics)",
    );
    await teardownBigQueryEventForwarderInfrastructure(existing);
    logger.info(
      {
        organizationId: context.org.id,
        eventForwarderConfigId: existing.id,
      },
      "Event forwarder sync: BigQuery Confluent teardown returned",
    );
  } else {
    logger.info(
      {
        organizationId: context.org.id,
        sinkType,
        eventForwarderConfigId: existing.id,
      },
      "Event forwarder sync: skipping Confluent BigQuery teardown (sink is not bigquery)",
    );
  }

  await context.models.eventForwarderConfigs.deleteForDatasourceCascade(
    existing,
  );
}
