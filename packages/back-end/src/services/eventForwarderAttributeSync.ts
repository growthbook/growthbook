import { attributeUpdateAffectsEventForwarderFactTableColumns } from "shared/util";
import { SDKAttribute, SDKAttributeSchema } from "shared/types/organization";
import { hasAnyEventForwarderConfig } from "back-end/src/services/eventForwarderConfig";
import { syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange } from "back-end/src/services/eventForwarderFactTable";
import {
  syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema,
  syncHashAttributeMetadataForEventForwarder,
} from "back-end/src/services/eventForwarderUserIdTypes";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export type EventForwarderAttributeChangeType = "create" | "update" | "delete";

export async function syncEventForwarderAfterAttributeSchemaChange(
  context: ReqContext,
  {
    attributeSchema,
    before,
    after,
    previousName,
    changeType,
  }: {
    attributeSchema: SDKAttributeSchema;
    before?: SDKAttribute;
    after?: SDKAttribute;
    previousName?: string;
    changeType: EventForwarderAttributeChangeType;
  },
): Promise<void> {
  if (!(await hasAnyEventForwarderConfig(context))) {
    return;
  }

  await syncEventForwarderHashAttributeMetadata(context, {
    attributeSchema,
    before,
    after,
    previousName,
    changeType,
  });

  await syncEventForwarderFactTableMetadata(context, {
    attributeSchema,
    before,
    after,
    changeType,
  });
}

async function syncEventForwarderHashAttributeMetadata(
  context: ReqContext,
  {
    attributeSchema,
    before,
    after,
    previousName,
    changeType,
  }: {
    attributeSchema: SDKAttributeSchema;
    before?: SDKAttribute;
    after?: SDKAttribute;
    previousName?: string;
    changeType: EventForwarderAttributeChangeType;
  },
): Promise<void> {
  try {
    if (changeType === "create" && after?.hashAttribute) {
      await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
        context,
        attributeSchema,
      );
      return;
    }

    if (changeType !== "update" || !after?.hashAttribute) {
      return;
    }

    if (!before?.hashAttribute) {
      await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
        context,
        attributeSchema,
      );
      return;
    }

    const oldName = previousName ?? before.property;
    const renamed = oldName !== after.property;
    const datatypeChanged = before.datatype !== after.datatype;

    if (renamed || datatypeChanged) {
      await syncHashAttributeMetadataForEventForwarder(context, {
        before,
        after,
        previousName,
        attributeSchema,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        organizationId: context.org.id,
        changeType,
        error: message,
      },
      "Failed to sync event forwarder hash attribute metadata after attribute schema change",
    );
  }
}

async function syncEventForwarderFactTableMetadata(
  context: ReqContext,
  {
    attributeSchema,
    before,
    after,
    changeType,
  }: {
    attributeSchema: SDKAttributeSchema;
    before?: SDKAttribute;
    after?: SDKAttribute;
    changeType: EventForwarderAttributeChangeType;
  },
): Promise<void> {
  const shouldSyncFactTable =
    changeType === "create" ||
    changeType === "delete" ||
    (changeType === "update" &&
      before !== undefined &&
      after !== undefined &&
      attributeUpdateAffectsEventForwarderFactTableColumns(before, after));

  if (!shouldSyncFactTable) {
    return;
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
        changeType,
        error: message,
      },
      "Failed to sync event forwarder fact table metadata after attribute schema change",
    );
  }
}
