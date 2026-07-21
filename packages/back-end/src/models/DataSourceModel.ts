import mongoose from "mongoose";
import uniqid from "uniqid";
import { cloneDeep, isEqual } from "lodash";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  isEventForwarderManagedExposureQuery,
  isEventForwarderManagedFeatureUsageQuery,
  isManagedWarehouseAwaitingProvisioning,
  isManagedWarehouseUnavailable,
} from "shared/util";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourcePipelineSettings,
  DataSourceSettings,
  DataSourceType,
} from "shared/types/datasource";
import { GoogleAnalyticsParams } from "shared/types/integrations/googleanalytics";
import { ApiDataSource } from "shared/validators";
import { getOauth2Client } from "back-end/src/integrations/GoogleAnalytics";
import {
  encryptParams,
  getSourceIntegrationObject,
  testDataSourceConnection,
  testQueryValidity,
  testFeatureUsageQueryValidity,
} from "back-end/src/services/datasource";
import {
  usingFileConfig,
  getConfigDatasources,
} from "back-end/src/init/config";
import { upgradeDatasourceObject } from "back-end/src/util/migrations";
import { getCollection } from "back-end/src/util/mongo.util";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { deleteClickhouseUser } from "back-end/src/services/licenseServerManagedClickhouse";
import { createModelAuditLogger } from "back-end/src/services/audit";
import { syncEventForwarderAfterDatasourceDeleted } from "back-end/src/services/eventForwarder/datasourceLifecycle";
import { deleteEventForwarderEventsFactTableForDatasource } from "back-end/src/services/eventForwarder/factTable";
import { deleteFactTable, getFactTable } from "./FactTableModel";

const dataSourceAuditConfig = {
  entity: "datasource",
  createEvent: "datasource.create",
  updateEvent: "datasource.update",
  deleteEvent: "datasource.delete",
  detailsAllowlist: [
    "id",
    "name",
    "description",
    "organization",
    "dateCreated",
    "dateUpdated",
    "type",
    "projects",
    "settings",
  ],
} as const;

const audit = createModelAuditLogger(dataSourceAuditConfig);

const dataSourceSchema = new mongoose.Schema<DataSourceDocument>({
  id: String,
  name: String,
  description: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String, index: true },
  params: String,
  projects: {
    type: [String],
    index: true,
  },
  settings: {},
});
dataSourceSchema.index({ id: 1, organization: 1 }, { unique: true });
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceInterface>(
  "DataSource",
  dataSourceSchema,
);

function toInterface(doc: DataSourceDocument): DataSourceInterface {
  return upgradeDatasourceObject(doc.toJSON());
}

export async function getInstallationDatasources(): Promise<
  DataSourceInterface[]
> {
  if (IS_CLOUD) {
    throw new Error("Cannot get all installation data sources in cloud mode");
  }
  if (usingFileConfig()) {
    // We don't need the correct organization part of the response so passing "".
    return getConfigDatasources("");
  }
  const docs: DataSourceDocument[] = await DataSourceModel.find();
  return docs.map(toInterface);
}

export async function getDataSourcesByOrganization(
  context: ReqContext | ApiReqContext,
): Promise<DataSourceInterface[]> {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDatasources(context.org.id);
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    organization: context.org.id,
  });

  const datasources = docs.map(toInterface);

  return datasources.filter((ds) =>
    context.permissions.canReadMultiProjectResource(ds.projects),
  );
}

// WARNING: This does not restrict by organization
export async function _dangerourslyGetAllDatasourcesByOrganizations(
  organizations: string[],
): Promise<DataSourceInterface[]> {
  const docs: DataSourceDocument[] = await DataSourceModel.find({
    organization: { $in: organizations },
  });

  return docs.map(toInterface);
}

export async function getGrowthbookDatasource(context: ReqContext) {
  const orgId = context.org.id;
  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    type: "growthbook_clickhouse",
    organization: orgId,
  });

  if (!doc) return null;

  const datasource = toInterface(doc);

  return context.permissions.canReadMultiProjectResource(datasource.projects)
    ? datasource
    : null;
}

// WARNING: bypasses project-read permission. System-only (managed-warehouse sync):
// the acting user may lack project read, and a checked lookup would silently desync.
export async function dangerouslyGetGrowthbookDatasourceBypassPermission(
  context: ReqContext | ApiReqContext,
): Promise<DataSourceInterface | null> {
  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    type: "growthbook_clickhouse",
    organization: context.org.id,
  });
  return doc ? toInterface(doc) : null;
}

/**
 * Read the managed-warehouse recreate coordination fields the license server
 * writes to the shared datasource doc: `lockUntil` (a rebuild is in progress) and
 * `recreateStatus` (its outcome). Both live top-level (outside `settings`, which
 * GrowthBook rewrites), so they aren't on the Mongoose schema — read them raw.
 */
export async function getManagedWarehouseRecreateState(
  context: ReqContext | ApiReqContext,
): Promise<{ locked: boolean; recreateStatus: "success" | "error" | null }> {
  const doc = await getCollection<{
    lockUntil?: Date | string | number | null;
    recreateStatus?: { status?: string } | null;
  }>("datasources").findOne(
    { organization: context.org.id, type: "growthbook_clickhouse" },
    { projection: { lockUntil: 1, recreateStatus: 1 } },
  );
  const lockUntil = doc?.lockUntil ? new Date(doc.lockUntil) : null;
  const locked = lockUntil !== null && lockUntil.getTime() > Date.now();
  const status = doc?.recreateStatus?.status;
  return {
    locked,
    recreateStatus: status === "success" || status === "error" ? status : null,
  };
}

/**
 * Clear the license-server recreate outcome at the start of a migration so a stale
 * `recreateStatus` from an earlier rebuild (e.g. a prior super-admin recreate) can't
 * be misread as the current migration's result. Raw `$unset` since `recreateStatus`
 * is a top-level field the license server owns, not on the Mongoose schema.
 */
export async function clearManagedWarehouseRecreateStatus(
  context: ReqContext | ApiReqContext,
): Promise<void> {
  await getCollection<{ recreateStatus?: unknown }>("datasources").updateOne(
    { organization: context.org.id, type: "growthbook_clickhouse" },
    { $unset: { recreateStatus: "" } },
  );
}

/**
 * Best-effort acquire of the license server's per-datasource lock (`lockUntil` —
 * top-level and schema-less like the recreate fields, with matching semantics) so
 * app-side managed-warehouse mutations can mutually exclude license-server
 * operations (provision/recreate) on the same doc. Returns false when the lock is
 * already held; pair with `unlockManagedWarehouseDatasource` in a `finally`.
 */
export async function tryLockManagedWarehouseDatasource(
  context: ReqContext | ApiReqContext,
  seconds: number,
): Promise<boolean> {
  const now = new Date();
  const result = await getCollection<{ lockUntil?: Date | null }>(
    "datasources",
  ).updateOne(
    {
      organization: context.org.id,
      type: "growthbook_clickhouse",
      $or: [
        { lockUntil: { $exists: false } },
        { lockUntil: null },
        { lockUntil: { $lte: now } },
      ],
    },
    { $set: { lockUntil: new Date(now.getTime() + seconds * 1000) } },
  );
  return result.matchedCount > 0;
}

export async function unlockManagedWarehouseDatasource(
  context: ReqContext | ApiReqContext,
): Promise<void> {
  await getCollection<{ lockUntil?: Date | null }>("datasources").updateOne(
    { organization: context.org.id, type: "growthbook_clickhouse" },
    { $set: { lockUntil: null } },
  );
}

export async function getDataSourceById(
  context: ReqContext | ApiReqContext,
  id: string,
) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(context.org.id).filter((d) => d.id === id)[0] || null
    );
  }

  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    id,
    organization: context.org.id,
  });

  if (!doc) return null;

  const datasource = toInterface(doc);

  return context.permissions.canReadMultiProjectResource(datasource.projects)
    ? datasource
    : null;
}

export async function getDataSourcesByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
) {
  if (usingFileConfig()) {
    return getConfigDatasources(context.org.id).filter((d) =>
      ids.includes(d.id),
    );
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    id: { $in: ids },
    organization: context.org.id,
  });

  return docs
    .map(toInterface)
    .filter((datasource) =>
      context.permissions.canReadMultiProjectResource(datasource.projects),
    );
}

export async function removeProjectFromDatasources(
  project: string,
  organization: string,
) {
  await DataSourceModel.updateMany(
    { organization, projects: project },
    { $pull: { projects: project } },
  );
}

export async function deleteDatasource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  await syncEventForwarderAfterDatasourceDeleted(context, datasource);

  // Event forwarder managed artifacts (Events fact table, exposure queries,
  // feature usage queries) are only removed when the datasource is deleted.
  // Disconnecting the forwarder alone does not delete them.
  try {
    await deleteEventForwarderEventsFactTableForDatasource(context, datasource);
  } catch (e) {
    logger.error(e, "Error deleting event forwarder Events fact table");
  }

  if (datasource.type === "growthbook_clickhouse") {
    if (!isManagedWarehouseAwaitingProvisioning(datasource)) {
      await deleteClickhouseUser(context.org.id);
    }

    // Also delete the main events fact table
    try {
      const ft = await getFactTable(
        context,
        MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
      );
      if (ft) {
        await deleteFactTable(context, ft, { bypassManagedByCheck: true });
      }
    } catch (e) {
      logger.error(e, "Error deleting clickhouse events fact table");
    }
  }
  await DataSourceModel.deleteOne({
    id: datasource.id,
    organization: context.org.id,
  });

  await audit.logDelete(context, datasource);
}

/**
 * Deletes data sources where the provided project is the only project of that data source.
 * Runs event-forwarder teardown per datasource before removal so Confluent resources are not orphaned.
 */
export async function deleteAllDataSourcesForAProject({
  context,
  projectId,
  organizationId,
}: {
  context: ReqContext | ApiReqContext;
  projectId: string;
  organizationId: string;
}) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }

  const docs = await DataSourceModel.find({
    organization: organizationId,
    projects: [projectId],
  });

  for (const doc of docs) {
    const datasource = toInterface(doc);
    await syncEventForwarderAfterDatasourceDeleted(context, datasource);
  }

  await DataSourceModel.deleteMany({
    organization: organizationId,
    projects: [projectId],
  });
}

export async function createDataSource(
  context: ReqContext,
  name: string,
  type: DataSourceType,
  params: DataSourceParams,
  settings: DataSourceSettings,
  id?: string,
  description: string = "",
  projects?: string[],
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  id = id || uniqid("ds_");
  projects = projects || [];

  if (type === "google_analytics") {
    const oauth2Client = getOauth2Client();
    const { tokens } = await oauth2Client.getToken(
      (params as GoogleAnalyticsParams).refreshToken,
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token || "";
  }

  const datasource: DataSourceInterface = {
    id,
    name,
    description,
    organization: context.org.id,
    type,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
    projects,
  };

  const skipManagedWarehouseConnection =
    isManagedWarehouseAwaitingProvisioning(datasource);

  if (!skipManagedWarehouseConnection) {
    await testDataSourceConnection(context, datasource);
  }

  // Add any missing exposure query ids and validate every query
  settings = await validateExposureQueriesAndAddMissingIds(
    context,
    datasource,
    settings,
    "all",
  );

  validatePipelineSettingsInvariants(settings.pipelineSettings);

  const model = (await DataSourceModel.create(
    datasource,
  )) as DataSourceDocument;

  const integration = getSourceIntegrationObject(context, datasource);
  if (
    !skipManagedWarehouseConnection &&
    integration.getInformationSchema &&
    integration.getSourceProperties().supportsInformationSchema
  ) {
    logger.debug("queueCreateInformationSchema");
    await queueCreateInformationSchema(datasource.id, context.org.id);
  }

  const datasourceInterface = toInterface(model);
  await audit.logCreate(context, datasourceInterface);
  return datasourceInterface;
}

// Which exposure queries to run a live validity test against.
export type ExposureQueryValidation =
  | "changed" // only new, changed, or previously-errored queries (default)
  | "all" // every query (used on datasource create)
  | "skip"; // none — assign missing ids but don't run any test queries

// Add any missing exposure query ids and validate queries per `validation`.
export async function validateExposureQueriesAndAddMissingIds(
  context: ReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceSettings>,
  validation: ExposureQueryValidation = "changed",
  skipEventForwarderManagedValidation: boolean = false,
): Promise<Partial<DataSourceSettings>> {
  const updatesCopy = cloneDeep(updates);
  if (updatesCopy.queries?.exposure) {
    await Promise.all(
      updatesCopy.queries.exposure.map(async (exposure) => {
        if (!exposure.id) {
          exposure.id = uniqid("exq_");
        }
        // Skip live validation while the warehouse can't serve queries — never
        // provisioned OR mid-migration (tables being recreated). Otherwise a
        // concurrent settings save would test-run against unavailable tables and
        // stamp a spurious error that self-heals only on the next validation.
        if (isManagedWarehouseUnavailable(datasource)) {
          exposure.error = undefined;
          return;
        }
        if (validation === "skip") {
          return;
        }

        if (
          skipEventForwarderManagedValidation &&
          isEventForwarderManagedExposureQuery(exposure) &&
          validation !== "all"
        ) {
          exposure.error = undefined;
          return;
        }

        // "all" validates everything; "changed" only validates queries that are
        // new (no matching saved query), changed, or previously errored.
        let checkValidity = validation === "all";
        if (!checkValidity) {
          const existingQuery = datasource.settings.queries?.exposure?.find(
            (q) => q.id == exposure.id,
          );
          if (
            !existingQuery ||
            !isEqual(existingQuery, exposure) ||
            existingQuery.error
          ) {
            checkValidity = true;
          }
        }

        if (checkValidity) {
          const integration = getSourceIntegrationObject(context, datasource);
          exposure.error = await testQueryValidity(
            integration,
            exposure,
            context.org.settings?.testQueryDays,
          );
        }
      }),
    );
  }
  if (updatesCopy.queries?.featureUsage) {
    await Promise.all(
      updatesCopy.queries.featureUsage.map(async (featureUsage) => {
        if (isManagedWarehouseUnavailable(datasource)) {
          featureUsage.error = undefined;
          return;
        }
        if (validation === "skip") {
          return;
        }

        if (
          skipEventForwarderManagedValidation &&
          isEventForwarderManagedFeatureUsageQuery(featureUsage) &&
          validation !== "all"
        ) {
          featureUsage.error = undefined;
          return;
        }

        let checkValidity = validation === "all";
        if (!checkValidity) {
          const existingQuery = datasource.settings.queries?.featureUsage?.find(
            (q) => q.id === featureUsage.id,
          );
          if (
            !existingQuery ||
            !isEqual(existingQuery, featureUsage) ||
            existingQuery.error
          ) {
            checkValidity = true;
          }
        }
        if (checkValidity) {
          const integration = getSourceIntegrationObject(context, datasource);
          featureUsage.error = await testFeatureUsageQueryValidity(
            integration,
            featureUsage,
            context.org.settings?.testQueryDays,
          );
        }
      }),
    );
  }
  return updatesCopy;
}

// Returns true if there are any actual changes, besides dateUpdated, from the actual datasource
export function hasActualChanges(
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>,
) {
  const updateKeys = Object.keys(updates).filter(
    (key) => key !== "dateUpdated",
  ) as Array<keyof DataSourceInterface>;

  return updateKeys.some((key) => !isEqual(datasource[key], updates[key]));
}

// Sanity-check pipeline settings before persisting. Mirrors the UI-level
// validation in EditDataSourcePipeline so direct API / config.yml callers
// can't save an opt-in list that snapshot planning will silently reject.
//
// We only enforce this for the new `incrementalOptInExperimentIds` path so
// existing customers updating an unrelated field on a data source with
// pre-existing (potentially non-strict) pipeline settings aren't affected.
function validatePipelineSettingsInvariants(
  pipelineSettings: DataSourcePipelineSettings | undefined,
) {
  if (!pipelineSettings) return;

  const optInCount =
    pipelineSettings.mode === "ephemeral"
      ? (pipelineSettings.incrementalOptInExperimentIds?.length ?? 0)
      : 0;
  if (optInCount === 0) return;

  if (!pipelineSettings.allowWriting) {
    throw new Error(
      "Cannot opt experiments into incremental refresh without allowWriting set to true.",
    );
  }
  if (!pipelineSettings.writeDataset) {
    throw new Error(
      "Cannot opt experiments into incremental refresh without a writeDataset configured.",
    );
  }
}

export async function updateDataSource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>,
  {
    skipExposureQueryValidation = false,
    forceCheckValidity = false,
    skipEventForwarderManagedValidation = false,
  }: {
    skipExposureQueryValidation?: boolean;
    forceCheckValidity?: boolean;
    skipEventForwarderManagedValidation?: boolean;
  } = {},
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  if (updates.settings) {
    updates.settings = await validateExposureQueriesAndAddMissingIds(
      context,
      datasource,
      updates.settings,
      skipExposureQueryValidation
        ? "skip"
        : forceCheckValidity
          ? "all"
          : "changed",
      skipEventForwarderManagedValidation,
    );
    validatePipelineSettingsInvariants(updates.settings.pipelineSettings);
  }
  if (!hasActualChanges(datasource, updates)) {
    return;
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization: context.org.id,
    },
    {
      $set: updates,
    },
  );

  await audit.logUpdate(context, datasource, { ...datasource, ...updates });
}

// WARNING: This does not restrict by organization
// Only use for deployment-wide actions like migration scripts or superadmin tools
export async function _dangerousGetAllDatasources(): Promise<
  DataSourceInterface[]
> {
  const all: DataSourceDocument[] = await DataSourceModel.find();
  return all.map(toInterface);
}

export function toDataSourceApiInterface(
  datasource: DataSourceInterface,
): ApiDataSource {
  const settings = datasource.settings;
  const obj: ApiDataSource = {
    id: datasource.id,
    dateCreated: datasource.dateCreated?.toISOString() || "",
    dateUpdated: datasource.dateUpdated?.toISOString() || "",
    type: datasource.type,
    name: datasource.name || "",
    description: datasource.description || "",
    projectIds: datasource.projects || [],
    identifierTypes: (settings?.userIdTypes || []).map((identifier) => ({
      id: identifier.userIdType,
      description: identifier.description || "",
    })),
    assignmentQueries: (settings?.queries?.exposure || []).map((q) => ({
      id: q.id,
      name: q.name,
      description: q.description || "",
      identifierType: q.userIdType,
      sql: q.query,
      includesNameColumns: !!q.hasNameCol,
      dimensionColumns: q.dimensions,
      error: q.error,
    })),
    identifierJoinQueries: (settings?.queries?.identityJoins || []).map(
      (q) => ({
        identifierTypes: q.ids,
        sql: q.query,
      }),
    ),
    eventTracker: settings?.schemaFormat || "custom",
  };

  if (datasource.type === "mixpanel") {
    obj.mixpanelSettings = {
      viewedExperimentEventName:
        settings?.events?.experimentEvent || "$experiment_started",
      experimentIdProperty:
        settings?.events?.experimentIdProperty || "Experiment name",
      variationIdProperty:
        settings?.events?.variationIdProperty || "Variant name",
      extraUserIdProperty: settings?.events?.extraUserIdProperty || "",
    };
  }

  return obj;
}
