import type { Response } from "express";
import { ProjectInterface, ProjectSettings } from "shared/types/project";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { stringToBoolean } from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  deleteAllDataSourcesForAProject,
  projectHasDataSources,
} from "back-end/src/models/DataSourceModel";
import {
  deleteAllMetricsForAProject,
  projectHasMetrics,
} from "back-end/src/models/MetricModel";
import {
  deleteAllFeaturesForAProject,
  projectHasFeatures,
} from "back-end/src/models/FeatureModel";
import {
  deleteAllExperimentsForAProject,
  projectHasExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  deleteAllSlackIntegrationsForAProject,
  projectHasSlackIntegrations,
} from "back-end/src/models/SlackIntegrationModel";
import {
  deleteAllFactTablesForAProject,
  projectHasFactTables,
} from "back-end/src/models/FactTableModel";
import { cleanupProjectReferences } from "back-end/src/services/projects";
import { promiseAllChunks } from "back-end/src/util/promise";

// region POST /projects

type CreateProjectRequest = AuthRequest<{
  name: string;
  description?: string;
  publicId?: string;
}>;

type CreateProjectResponse = {
  status: 200;
  project: ProjectInterface;
};

/**
 * POST /projects
 * Create a project resource
 * @param req
 * @param res
 */
export const postProject = async (
  req: CreateProjectRequest,
  res: Response<
    CreateProjectResponse | ApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canCreateProjects()) {
    context.permissions.throwPermissionError();
  }
  const { name, description, publicId } = req.body;

  const doc = await context.models.projects.create({
    name,
    description,
    publicId,
  });

  res.status(200).json({
    status: 200,
    project: doc,
  });
};

// endregion POST /projects

// region PUT /projects/:id

type PutProjectRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type PutProjectResponse = {
  status: 200;
};

/**
 * PUT /projects/:id
 * Update one project resource
 * @param req
 * @param res
 */
export const putProject = async (
  req: PutProjectRequest,
  res: Response<
    PutProjectResponse | ApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const { id } = req.params;

  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateProject(id)) {
    context.permissions.throwPermissionError();
  }

  const project = await context.models.projects.getById(id);

  if (!project) {
    res.status(404).json({
      message: "Could not find project",
    });
    return;
  }

  const { name, description, publicId } = req.body;

  await context.models.projects.updateById(id, {
    name,
    description,
    publicId,
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion PUT /projects/:id

// region DELETE /projects/:id

type DeleteProjectRequest = AuthRequest<
  null,
  { id: string },
  {
    deleteResources?: string;
  }
>;

type DeleteProjectResponse = {
  status: number;
};

/**
 * DELETE /projects/:id
 * Delete one project resource by ID
 * @param req
 * @param res
 */
export const deleteProject = async (
  req: DeleteProjectRequest,
  res: Response<
    DeleteProjectResponse | ApiErrorResponse,
    EventUserForResponseLocals
  >,
) => {
  const { id } = req.params;
  const deleteResources = stringToBoolean(req.query.deleteResources, false);
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteProject(id)) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;

  const failedToDeleteResources: string[] = [];

  // Build the list of resource cleanups to run. For each resource type, only
  // require its delete permission if the project actually has resources of
  // that type — otherwise deleting an empty project would need permissions the
  // user has no reason to hold. All permission checks run (and can fail early)
  // before any delete executes.
  const resourceDeletes: { label: string; run: () => Promise<unknown> }[] = [];
  if (deleteResources) {
    const requirePermission = (allowed: boolean) => {
      if (!allowed) context.permissions.throwPermissionError();
    };

    if (await projectHasDataSources(org.id, id)) {
      requirePermission(
        context.permissions.canDeleteDataSource({ projects: [id] }),
      );
      resourceDeletes.push({
        label: "data sources",
        run: () =>
          deleteAllDataSourcesForAProject({
            context,
            projectId: id,
            organizationId: org.id,
          }),
      });
    }

    if (await projectHasMetrics(context, id)) {
      requirePermission(
        context.permissions.canDeleteMetric({ projects: [id] }),
      );
      resourceDeletes.push({
        label: "metrics",
        run: () => deleteAllMetricsForAProject({ projectId: id, context }),
      });
    }

    if (await projectHasFactTables(context, id)) {
      requirePermission(
        context.permissions.canDeleteFactTable({ projects: [id] }),
      );
      resourceDeletes.push({
        label: "fact tables",
        run: () => deleteAllFactTablesForAProject({ projectId: id, context }),
      });
    }

    if (await context.models.factMetrics.projectHasFactMetrics(id)) {
      requirePermission(
        context.permissions.canDeleteFactMetric({ projects: [id] }),
      );
      resourceDeletes.push({
        label: "fact metrics",
        run: () =>
          context.models.factMetrics.deleteAllFactMetricsForAProject(id),
      });
    }

    if (await projectHasFeatures(context, id)) {
      requirePermission(context.permissions.canDeleteFeature({ project: id }));
      resourceDeletes.push({
        label: "features",
        run: () => deleteAllFeaturesForAProject({ projectId: id, context }),
      });
    }

    if (await projectHasExperiments(context, id)) {
      requirePermission(
        context.permissions.canDeleteExperiment({ project: id }),
      );
      resourceDeletes.push({
        label: "experiments",
        run: () => deleteAllExperimentsForAProject({ projectId: id, context }),
      });
    }

    if (await projectHasSlackIntegrations(org.id, id)) {
      requirePermission(context.permissions.canManageIntegrations());
      resourceDeletes.push({
        label: "Slack integrations",
        run: () =>
          deleteAllSlackIntegrationsForAProject({
            projectId: id,
            organization: org,
          }),
      });
    }
  }

  // All permission checks passed — now delete the project and its resources.
  await context.models.projects.deleteById(id);

  const results = await promiseAllChunks(
    resourceDeletes.map(({ label, run }) => async () => {
      try {
        await run();
        return null;
      } catch (e) {
        return label;
      }
    }),
    5,
  );
  failedToDeleteResources.push(
    ...results.filter((label): label is string => label !== null),
  );

  // Remove references to the project from surviving multi-project resources
  // and org-level settings. When resources were deleted above, skip the
  // resource references — a resource that survived a failed delete should
  // keep its project scoping rather than fall back to "All Projects".
  failedToDeleteResources.push(
    ...(await cleanupProjectReferences(context, id, {
      includeResourceReferences: !deleteResources,
    })),
  );

  // TODO: other resources to clean up
  // ideas?
  // dimensions?
  // segments?
  // webhooks?
  // safe rollouts?
  // custom hooks?
  // custom fields?
  // pre-launch checklists?

  if (deleteResources && failedToDeleteResources.length > 0) {
    const message =
      `Project deleted, but failed to delete the following resources: ` +
      failedToDeleteResources.join(", ");
    res.status(400).json({
      status: 400,
      message,
    });
    return;
  }

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /projects/:id

type PutProjectSettingsRequest = AuthRequest<
  { settings: ProjectSettings },
  { id: string }
>;
type PutProjectSettingsResponse = {
  status: 200;
  settings: ProjectSettings;
};
export const putProjectSettings = async (
  req: PutProjectSettingsRequest,
  res: Response<PutProjectSettingsResponse | ApiErrorResponse>,
) => {
  const { id } = req.params;

  const context = getContextFromReq(req);

  if (!context.permissions.canUpdateProject(id)) {
    context.permissions.throwPermissionError();
  }

  const project = await context.models.projects.getById(id);

  if (!project) {
    res.status(404).json({
      message: "Could not find project",
    });
    return;
  }

  const { settings } = req.body;

  await context.models.projects.update(project, { settings });

  res.status(200).json({
    status: 200,
    settings,
  });
};
