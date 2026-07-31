import {
  DataSourceInterface,
  DataSourceSettings,
  UserIdType,
} from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  findDuplicateUserIdTypeName,
  getEventForwarderUserIdTypeSourceAttribute,
  isEventForwarderManagedUserIdType,
  normalizeUserIdTypeName,
  reconcileEventForwarderManagedExposureQueries,
} from "shared/util";
import { getEventForwarderForDatasource } from "back-end/src/services/eventForwarder/config";
import { buildExposureQueryParams } from "back-end/src/services/eventForwarder/sinkParams";
import { syncEventForwarderEventsFactTableMetadata } from "back-end/src/services/eventForwarder/factTable";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export type UserIdTypeRename = {
  from: string;
  to: string;
  sourceAttribute: string;
};

/**
 * Clients own an identifier type's name, description, and linked attributes;
 * GrowthBook owns whether it is Event Forwarder managed and which attribute it
 * reads. Re-derive those two fields from what is already stored so an update can
 * never promote a user-created identifier type to managed, or repoint a managed
 * one at a different attribute.
 */
function relinkManagedUserIdTypes(
  existing: UserIdType[],
  incoming: UserIdType[],
): UserIdType[] {
  const managedBySource = new Map(
    existing
      .filter(isEventForwarderManagedUserIdType)
      .map((entry) => [
        normalizeUserIdTypeName(
          getEventForwarderUserIdTypeSourceAttribute(entry),
        ),
        entry,
      ]),
  );
  const existingByName = new Map(
    existing.map((entry) => [normalizeUserIdTypeName(entry.userIdType), entry]),
  );

  return incoming.map((entry) => {
    const base: UserIdType = {
      userIdType: entry.userIdType,
      description: entry.description,
      attributes: entry.attributes,
    };

    // A rename changes the name, so the stored link is what identifies the entry.
    // Fall back to the name for entries that predate the link or were untouched.
    const match =
      (entry.sourceAttribute
        ? managedBySource.get(normalizeUserIdTypeName(entry.sourceAttribute))
        : undefined) ??
      existingByName.get(normalizeUserIdTypeName(entry.userIdType));

    if (!match || !isEventForwarderManagedUserIdType(match)) {
      return base;
    }

    return {
      ...base,
      managedBy: "api",
      sourceAttribute: getEventForwarderUserIdTypeSourceAttribute(match),
    };
  });
}

/** Renames of managed identifier types, matched on their source attribute. */
export function getEventForwarderUserIdTypeRenames(
  existing: UserIdType[],
  updated: UserIdType[],
): UserIdTypeRename[] {
  const existingBySource = new Map(
    existing
      .filter(isEventForwarderManagedUserIdType)
      .map((entry) => [
        normalizeUserIdTypeName(
          getEventForwarderUserIdTypeSourceAttribute(entry),
        ),
        entry,
      ]),
  );

  const renames: UserIdTypeRename[] = [];
  for (const entry of updated) {
    if (!isEventForwarderManagedUserIdType(entry)) {
      continue;
    }
    const sourceAttribute = getEventForwarderUserIdTypeSourceAttribute(entry);
    const before = existingBySource.get(
      normalizeUserIdTypeName(sourceAttribute),
    );
    if (!before || before.userIdType === entry.userIdType) {
      continue;
    }
    renames.push({
      from: before.userIdType,
      to: entry.userIdType,
      sourceAttribute,
    });
  }

  return renames;
}

function renameIdentityJoinIds(
  settings: DataSourceSettings,
  renames: UserIdTypeRename[],
): DataSourceSettings {
  const identityJoins = settings.queries?.identityJoins;
  if (!identityJoins?.length) {
    return settings;
  }

  const renamedBy = new Map(
    renames.map((rename) => [normalizeUserIdTypeName(rename.from), rename.to]),
  );

  return {
    ...settings,
    queries: {
      ...settings.queries,
      identityJoins: identityJoins.map((join) => ({
        ...join,
        ids: join.ids.map(
          (id) => renamedBy.get(normalizeUserIdTypeName(id)) ?? id,
        ),
      })),
    },
  };
}

/**
 * Validates an incoming identifier-type list and cascades any rename of an Event
 * Forwarder managed identifier type through the settings being saved: the managed
 * exposure query (name, column alias, and regenerated SQL — its id is preserved
 * because experiments reference it) and any identity join referencing the old name.
 *
 * Returns the settings to persist plus the renames applied, which the caller
 * passes to syncEventForwarderAfterIdentifierTypesUpdate once the save lands.
 * Throws when two identifier types would share a name.
 */
export async function applyEventForwarderIdentifierTypeUpdates({
  context,
  datasource,
  settings,
}: {
  context: ReqContext;
  datasource: DataSourceInterface;
  settings: DataSourceSettings;
}): Promise<{ settings: DataSourceSettings; renames: UserIdTypeRename[] }> {
  const incoming = settings.userIdTypes;
  if (!incoming) {
    return { settings, renames: [] };
  }

  const duplicate = findDuplicateUserIdTypeName(incoming);
  if (duplicate) {
    throw new Error(
      `Identifier type ${duplicate} is already in use. Identifier type names must be unique within a Data Source.`,
    );
  }

  const existing = datasource.settings?.userIdTypes ?? [];
  const userIdTypes = relinkManagedUserIdTypes(existing, incoming);
  const renames = getEventForwarderUserIdTypeRenames(existing, userIdTypes);
  const updatedSettings: DataSourceSettings = { ...settings, userIdTypes };

  if (renames.length === 0) {
    return { settings: updatedSettings, renames };
  }

  const eventForwarderConfig = await getEventForwarderForDatasource(
    context,
    datasource.id,
  );
  if (!eventForwarderConfig) {
    return {
      settings: renameIdentityJoinIds(updatedSettings, renames),
      renames,
    };
  }

  const connectionParams = getSourceIntegrationObject(context, datasource)
    .params as BigQueryConnectionParams | SnowflakeConnectionParams;
  const sqlParams = buildExposureQueryParams(
    eventForwarderConfig,
    connectionParams,
  );
  if (!sqlParams) {
    logger.warn(
      {
        datasourceId: datasource.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder exposure query rename: missing sink connection params",
    );
    return {
      settings: renameIdentityJoinIds(updatedSettings, renames),
      renames,
    };
  }

  const exposure = reconcileEventForwarderManagedExposureQueries({
    existing: settings.queries?.exposure ?? [],
    userIdTypes: userIdTypes.filter(isEventForwarderManagedUserIdType),
    params: sqlParams,
    attributeSchema: context.org.settings?.attributeSchema ?? [],
  });

  return {
    settings: renameIdentityJoinIds(
      {
        ...updatedSettings,
        queries: {
          ...updatedSettings.queries,
          exposure,
        },
      },
      renames,
    ),
    renames,
  };
}

/**
 * Cascades a committed identifier-type rename to the warehouse side: the Events
 * fact table's userIdTypes, SQL, and column metadata, then a delayed warehouse
 * sync. Never throws — the datasource update it follows is already committed.
 */
export async function syncEventForwarderAfterIdentifierTypesUpdate(
  context: ReqContext,
  datasource: DataSourceInterface,
  renames: UserIdTypeRename[],
): Promise<void> {
  if (renames.length === 0) {
    return;
  }

  try {
    await syncEventForwarderEventsFactTableMetadata(
      context,
      context.org.settings?.attributeSchema ?? [],
    );
    await queueDelayedEventForwarderWarehouseSyncForDatasource(
      context,
      datasource.id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        datasourceId: datasource.id,
        organizationId: context.org.id,
        renames,
        error: message,
      },
      "Failed to sync event forwarder warehouse metadata after identifier type rename",
    );
  }
}
