import { SDKAttributeSchema } from "shared/types/organization";
import { hasAnyEventForwarderConfig } from "back-end/src/services/eventForwarderConfig";
import { syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange } from "back-end/src/services/eventForwarderFactTable";
import { reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries } from "back-end/src/services/eventForwarderUserIdTypes";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function syncEventForwarderAfterAttributeSchemaChange(
  context: ReqContext,
  {
    attributeSchema,
  }: {
    attributeSchema: SDKAttributeSchema;
  },
): Promise<void> {
  if (!(await hasAnyEventForwarderConfig(context))) {
    return;
  }

  try {
    await reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries(
      context,
      attributeSchema,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        organizationId: context.org.id,
        error: message,
      },
      "Failed to reconcile event forwarder datasource metadata after attribute schema change",
    );
  }

  try {
    await syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange(
      context,
      attributeSchema,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        organizationId: context.org.id,
        error: message,
      },
      "Failed to sync event forwarder fact table metadata after attribute schema change",
    );
  }
}
