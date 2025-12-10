import type { Response } from "express";
import { ProjectInterface, ProjectSettings } from "shared/types/project";
import { EventUserForResponseLocals } from "shared/types/events/event-types";
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
    deleteFeatures?: boolean;
    deleteExperiments?: boolean;
    deleteMetrics?: boolean;
    deleteSlackIntegrations?: boolean;
    deleteDataSources?: boolean;
    deleteFactTables?: boolean;
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
  const {
    deleteExperiments = false,
    deleteFeatures = false,
    deleteMetrics = false,
    deleteSlackIntegrations = false,
    deleteDataSources = false,
    deleteFactTables = false,
  } = req.query;
  const context = getContextFromReq(req);

  if (!context.permissions.canDeleteProject(id)) {
    context.permissions.throwPermissionError();
  }
  const { org } = context;

  await context.models.projects.deleteById(id);

  // Cleanup functions from other models
  // Clean up data sources
  if (deleteDataSources) {
    try {
      if (!context.permissions.canDeleteDataSource({ projects: [id] })) {
        context.permissions.throwPermissionError();
      }

      await deleteAllDataSourcesForAProject({
        projectId: id,
        organizationId: org.id,
      });
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete data sources",
      });
    }
  } else {
    await removeProjectFromDatasources(id, org.id);
  }

  // Clean up metrics
  if (deleteMetrics) {
    try {
      if (!context.permissions.canDeleteMetric({ projects: [id] })) {
        context.permissions.throwPermissionError();
      }
      await deleteAllMetricsForAProject({
        projectId: id,
        context,
      });
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete metrics",
      });
    }
  } else {
    await removeProjectFromMetrics(id, org.id);
  }

  // Clean up fact tables and metrics
  if (deleteFactTables) {
    try {
      await deleteAllFactTablesForAProject({
        projectId: id,
        context,
      });
      await context.models.factMetrics.deleteAllFactMetricsForAProject(id);
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete fact tables",
      });
    }
  }

  // Clean up features
  if (deleteFeatures) {
    try {
      if (!context.permissions.canDeleteFeature({ project: id })) {
        context.permissions.throwPermissionError();
      }

      await deleteAllFeaturesForAProject({
        projectId: id,
        context,
      });
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete features",
      });
    }
  } else {
    await removeProjectFromFeatures(context, id);
  }

  // Clean up experiments
  if (deleteExperiments) {
    try {
      if (!context.permissions.canDeleteExperiment({ project: id })) {
        context.permissions.throwPermissionError();
      }
      await deleteAllExperimentsForAProject({
        projectId: id,
        context,
      });
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete experiments",
      });
    }
  } else {
    await removeProjectFromExperiments(context, id);
  }

  // Clean up Slack integrations
  if (deleteSlackIntegrations) {
    try {
      if (!context.permissions.canManageIntegrations()) {
        context.permissions.throwPermissionError();
      }

      await deleteAllSlackIntegrationsForAProject({
        projectId: id,
        organization: org,
      });
    } catch (e) {
      return res.json({
        status: 403,
        message: "Failed to delete Slack integrations",
      });
    }
  } else {
    await removeProjectFromSlackIntegration({
      organizationId: org.id,
      projectId: id,
    });
  }

  await removeProjectFromProjectRoles(id, org);

  await removeProjectFromSavedGroups(id, org.id);

  // ideas?
  // report?
  // dimensions?
  // api endpoints & webhooks?

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
