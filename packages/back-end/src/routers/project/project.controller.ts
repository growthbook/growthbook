import type { Response } from "express";
import { ProjectInterface, ProjectSettings } from "shared/types/project";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
import { stringToBoolean } from "shared/util";
import { removeProjectFromSavedGroups } from "back-end/src/models/SavedGroupModel";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  deleteAllDataSourcesForAProject,
  removeProjectFromDatasources,
} from "back-end/src/models/DataSourceModel";
import {
  deleteAllMetricsForAProject,
  removeProjectFromMetrics,
} from "back-end/src/models/MetricModel";
import {
  deleteAllFeaturesForAProject,
  removeProjectFromFeatures,
} from "back-end/src/models/FeatureModel";
import { removeProjectFromProjectRoles } from "back-end/src/models/OrganizationModel";
import {
  deleteAllExperimentsForAProject,
  removeProjectFromExperiments,
} from "back-end/src/models/ExperimentModel";
import {
  deleteAllSlackIntegrationsForAProject,
  removeProjectFromSlackIntegration,
} from "back-end/src/models/SlackIntegrationModel";
import { deleteAllFactTablesForAProject } from "back-end/src/models/FactTableModel";

// region POST /projects

type CreateProjectRequest = AuthRequest<{ name: string; description: string }>;

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
  const { name, description } = req.body;

  const doc = await context.models.projects.create({
    name,
    description,
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

  const { name, description } = req.body;

  await context.models.projects.updateById(id, {
    name,
    description,
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

  await context.models.projects.deleteById(id);

  const failedToDeleteResources: string[] = [];

  // Cleanup functions from other models
  // Clean up data sources
  try {
    if (deleteResources) {
      if (!context.permissions.canDeleteDataSource({ projects: [id] })) {
        context.permissions.throwPermissionError();
      }

      await deleteAllDataSourcesForAProject({
        projectId: id,
        organizationId: org.id,
      });
    } else {
      await removeProjectFromDatasources(id, org.id);
    }
  } catch (e) {
    failedToDeleteResources.push("data sources");
  }

  // Clean up metrics
  try {
    if (deleteResources) {
      if (!context.permissions.canDeleteMetric({ projects: [id] })) {
        context.permissions.throwPermissionError();
      }
      await deleteAllMetricsForAProject({
        projectId: id,
        context,
      });
    } else {
      await removeProjectFromMetrics(id, org.id);
    }
  } catch (e) {
    failedToDeleteResources.push("metrics");
  }

  // Clean up fact tables and metrics
  try {
    if (deleteResources) {
      await deleteAllFactTablesForAProject({
        projectId: id,
        context,
      });
      await context.models.factMetrics.deleteAllFactMetricsForAProject(id);
    }
  } catch (e) {
    failedToDeleteResources.push("fact tables and metrics");
  }

  // Clean up features
  try {
    if (deleteResources) {
      if (!context.permissions.canDeleteFeature({ project: id })) {
        context.permissions.throwPermissionError();
      }

      await deleteAllFeaturesForAProject({
        projectId: id,
        context,
      });
    } else {
      await removeProjectFromFeatures(context, id);
    }
  } catch (e) {
    failedToDeleteResources.push("features");
  }

  // Clean up experiments
  try {
    if (deleteResources) {
      if (!context.permissions.canDeleteExperiment({ project: id })) {
        context.permissions.throwPermissionError();
      }
      await deleteAllExperimentsForAProject({
        projectId: id,
        context,
      });
    } else {
      await removeProjectFromExperiments(context, id);
    }
  } catch (e) {
    failedToDeleteResources.push("experiments");
  }

  // Clean up Slack integrations
  try {
    if (deleteResources) {
      if (!context.permissions.canManageIntegrations()) {
        context.permissions.throwPermissionError();
      }

      await deleteAllSlackIntegrationsForAProject({
        projectId: id,
        organization: org,
      });
    } else {
      await removeProjectFromSlackIntegration({
        organizationId: org.id,
        projectId: id,
      });
    }
  } catch (e) {
    failedToDeleteResources.push("Slack integrations");
  }

  // Clean up project roles
  try {
    await removeProjectFromProjectRoles(id, org);
  } catch (e) {
    failedToDeleteResources.push("project roles");
  }

  // Clean up saved groups
  try {
    await removeProjectFromSavedGroups(id, org.id);
  } catch (e) {
    failedToDeleteResources.push("saved groups");
  }

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
