import { z } from "zod";
import {
  deleteDataSourceValidator,
  postDataSourceInformationSchemaRefreshValidator,
  postDataSourceValidator,
  updateDataSourceValidator,
} from "shared/validators";
import {
  DataSourceParams,
  DataSourceSettings,
  SchemaFormat,
} from "shared/types/datasource";
import {
  createDataSource,
  getDataSourceById,
  toDataSourceApiInterface,
} from "back-end/src/models/DataSourceModel";
import { getInformationSchemaByDatasourceId } from "back-end/src/models/InformationSchemaModel";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { queueUpdateInformationSchema } from "back-end/src/jobs/updateInformationSchema";
import {
  deleteDataSourceWithChecks,
  updateDataSourceWithChecks,
} from "back-end/src/services/datasourceChanges";
import { NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { createApiRequestHandler } from "back-end/src/util/handler";

type SettingsInput = Omit<
  z.infer<typeof updateDataSourceValidator.bodySchema>,
  "name" | "description" | "params" | "projectIds"
>;

/**
 * Maps the API's names onto stored settings. Entries matched by id keep the
 * fields the API doesn't expose (e.g. dimension slices, Event Forwarder links).
 */
export function applyApiDataSourceSettings(
  input: SettingsInput,
  existing: DataSourceSettings = {},
): DataSourceSettings {
  const settings: DataSourceSettings = {
    ...existing,
    queries: { ...existing.queries },
  };

  if (input.eventTracker !== undefined) {
    settings.schemaFormat = input.eventTracker as SchemaFormat;
  }
  if (input.identifierTypes) {
    const prev = new Map(
      (existing.userIdTypes ?? []).map((t) => [t.userIdType, t]),
    );
    settings.userIdTypes = input.identifierTypes.map((t) => ({
      ...prev.get(t.id),
      userIdType: t.id,
      description: t.description,
    }));
  }
  if (input.assignmentQueries) {
    const prev = new Map(
      (existing.queries?.exposure ?? []).map((q) => [q.id, q]),
    );
    settings.queries = {
      ...settings.queries,
      exposure: input.assignmentQueries.map((q) => ({
        ...(q.id ? prev.get(q.id) : undefined),
        id: q.id ?? "",
        name: q.name,
        description: q.description,
        userIdType: q.identifierType,
        query: q.sql,
        hasNameCol: q.includesNameColumns,
        dimensions: q.dimensionColumns ?? [],
      })),
    };
  }
  if (input.identifierJoinQueries) {
    settings.queries = {
      ...settings.queries,
      identityJoins: input.identifierJoinQueries.map((q) => ({
        ids: q.identifierTypes,
        query: q.sql,
      })),
    };
  }
  if (input.mixpanelSettings) {
    const m = input.mixpanelSettings;
    settings.events = {
      ...existing.events,
      ...(m.viewedExperimentEventName !== undefined && {
        experimentEvent: m.viewedExperimentEventName,
      }),
      ...(m.experimentIdProperty !== undefined && {
        experimentIdProperty: m.experimentIdProperty,
      }),
      ...(m.variationIdProperty !== undefined && {
        variationIdProperty: m.variationIdProperty,
      }),
      ...(m.extraUserIdProperty !== undefined && {
        extraUserIdProperty: m.extraUserIdProperty,
      }),
    };
  }
  if (input.pipelineSettings) {
    settings.pipelineSettings = input.pipelineSettings;
  }
  // Stored as strings for the settings form
  if (input.maxConcurrentQueries !== undefined) {
    settings.maxConcurrentQueries = String(input.maxConcurrentQueries);
  }
  if (input.queryCacheTTLMins !== undefined) {
    settings.queryCacheTTLMins = String(input.queryCacheTTLMins);
  }
  return settings;
}

async function getDataSource(context: ApiReqContext, id: string) {
  const datasource = await getDataSourceById(context, id);
  if (!datasource) throw new NotFoundError(`Data source not found: ${id}`);
  return datasource;
}

export const postDataSource = createApiRequestHandler(postDataSourceValidator)(
  async (req) => {
    const { context } = req;
    const { name, description, type, params, projectIds, ...settingsInput } =
      req.body;
    if (
      !context.permissions.canCreateDataSource({ projects: projectIds, type })
    ) {
      context.permissions.throwPermissionError();
    }
    if (projectIds?.length) {
      await context.models.projects.ensureProjectsExist(projectIds);
    }
    const settings = applyApiDataSourceSettings(settingsInput);
    // Same defaults the app sets on create
    settings.events = {
      experimentEvent: "$experiment_started",
      experimentIdProperty: "Experiment name",
      variationIdProperty: "Variant name",
      ...settings.events,
    };

    const datasource = await createDataSource(
      context as ReqContext,
      name,
      type,
      params as unknown as DataSourceParams,
      settings,
      undefined,
      description,
      projectIds,
    );
    // Re-read so ids the model assigned while validating are included
    const saved = await getDataSource(context, datasource.id);
    return { dataSource: toDataSourceApiInterface(saved) };
  },
);

export const updateDataSource = createApiRequestHandler(
  updateDataSourceValidator,
)(async (req) => {
  const { context } = req;
  const datasource = await getDataSource(context, req.params.id);
  const { name, description, params, projectIds, ...settingsInput } = req.body;
  if (projectIds?.length) {
    await context.models.projects.ensureProjectsExist(projectIds);
  }
  const hasSettings = Object.keys(settingsInput).length > 0;

  const { eventForwarderWarning } = await updateDataSourceWithChecks(
    context,
    datasource,
    {
      name,
      projects: projectIds,
      params: params as Partial<DataSourceParams> | undefined,
      settings: hasSettings
        ? applyApiDataSourceSettings(settingsInput, datasource.settings)
        : undefined,
      ...(description !== undefined ? { description } : {}),
    },
  );
  const saved = await getDataSource(context, datasource.id);
  return {
    dataSource: toDataSourceApiInterface(saved),
    ...(eventForwarderWarning ? { eventForwarderWarning } : {}),
  };
});

export const deleteDataSource = createApiRequestHandler(
  deleteDataSourceValidator,
)(async (req) => {
  const datasource = await getDataSource(req.context, req.params.id);
  await deleteDataSourceWithChecks(req.context, datasource);
  return { deletedId: datasource.id };
});

export const postDataSourceInformationSchemaRefresh = createApiRequestHandler(
  postDataSourceInformationSchemaRefreshValidator,
)(async (req) => {
  const { context } = req;
  const datasource = await getDataSource(context, req.params.id);
  const existing = await getInformationSchemaByDatasourceId(
    datasource.id,
    context.org.id,
  );
  // Same permissions as the app's create and refresh actions
  if (existing) {
    if (!context.permissions.canRunSchemaQueries(datasource)) {
      context.permissions.throwPermissionError();
    }
    await queueUpdateInformationSchema(
      datasource.id,
      context.org.id,
      existing.id,
    );
  } else {
    if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
      context.permissions.throwPermissionError();
    }
    await queueCreateInformationSchema(datasource.id, context.org.id);
  }
  return { queued: true as const };
});
