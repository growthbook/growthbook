import { z } from "zod";
import { isEqual } from "lodash";
import { getExposureQueryIdentifierTypes } from "shared/util";
import {
  deleteDataSourceValidator,
  postDataSourceInformationSchemaRefreshValidator,
  postDataSourceValidator,
  updateDataSourceValidator,
} from "shared/validators";
import {
  DataSourceParams,
  DataSourceSettings,
  ExposureQuery,
  SchemaFormat,
  UserIdType,
} from "shared/types/datasource";
import {
  createDataSource,
  getDataSourceById,
  toDataSourceApiInterface,
} from "back-end/src/models/DataSourceModel";
import {
  getInformationSchemaByDatasourceId,
  updateInformationSchemaById,
} from "back-end/src/models/InformationSchemaModel";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { queueUpdateInformationSchema } from "back-end/src/jobs/updateInformationSchema";
import {
  deleteDataSourceWithChecks,
  updateDataSourceWithChecks,
} from "back-end/src/services/datasourceChanges";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
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
    // A field only changes when it differs from what GET shows for it, so a
    // read posted back is a no-op (Event Forwarder records refuse any edit)
    settings.userIdTypes = input.identifierTypes.map((t) => {
      const updated: UserIdType = { ...prev.get(t.id), userIdType: t.id };
      if (
        t.description !== undefined &&
        t.description !== (updated.description || "")
      ) {
        updated.description = t.description;
      }
      return updated;
    });
  }
  if (input.assignmentQueries) {
    const prev = new Map(
      (existing.queries?.exposure ?? []).map((q) => [q.id, q]),
    );
    settings.queries = {
      ...settings.queries,
      exposure: input.assignmentQueries.map((q) => {
        const match = q.id ? prev.get(q.id) : undefined;
        const userIdTypes =
          q.identifierTypes ??
          (q.identifierType ? [q.identifierType] : undefined);
        const updated: ExposureQuery = {
          ...(match ?? {
            userIdType: userIdTypes?.[0] ?? "",
            userIdTypes: [],
            dimensions: [],
          }),
          id: q.id ?? "",
          name: q.name,
          query: q.sql,
        };
        const shown = match ? getExposureQueryIdentifierTypes(match) : [];
        if (userIdTypes && !isEqual(userIdTypes, shown)) {
          updated.userIdTypes = userIdTypes;
        }
        if (
          q.description !== undefined &&
          q.description !== (match?.description || "")
        ) {
          updated.description = q.description;
        }
        if (
          q.includesNameColumns !== undefined &&
          q.includesNameColumns !== !!match?.hasNameCol
        ) {
          updated.hasNameCol = q.includesNameColumns;
        }
        if (
          q.dimensionColumns &&
          !isEqual(q.dimensionColumns, match?.dimensions ?? [])
        ) {
          updated.dimensions = q.dimensionColumns;
        }
        return updated;
      }),
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
    const { includedExperimentIds, ...pipelineSettings } =
      input.pipelineSettings;
    settings.pipelineSettings = {
      ...existing.pipelineSettings,
      ...pipelineSettings,
    };
    // Every experiment is stored as no list; an empty list means none
    if (includedExperimentIds === null) {
      delete settings.pipelineSettings.includedExperimentIds;
    } else if (includedExperimentIds) {
      settings.pipelineSettings.includedExperimentIds = includedExperimentIds;
    }
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
    // The app generates a built-in tracker's queries; the API can't yet
    const { eventTracker, assignmentQueries } = settingsInput;
    if (
      eventTracker &&
      eventTracker !== "custom" &&
      !assignmentQueries?.length
    ) {
      throw new BadRequestError(
        `The ${eventTracker} event tracker's default identifier types and queries are generated by the app. Create this data source in the app, or send assignmentQueries for it.`,
      );
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
    return { dataSource: toDataSourceApiInterface(datasource) };
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
    // So a client polling for this refresh can't mistake the last result for it
    await updateInformationSchemaById(context.org.id, existing.id, {
      status: "PENDING",
      error: null,
    });
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
