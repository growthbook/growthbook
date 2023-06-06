import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { ProjectInterface, ProjectSettings } from "../../../types/project";
import {
  createProject,
  deleteProjectById,
  findProjectById,
  updateProject,
  updateProjectSettings,
} from "../../models/ProjectModel";
import { removeProjectFromDatasources } from "../../models/DataSourceModel";
import { removeProjectFromMetrics } from "../../models/MetricModel";
import { removeProjectFromFeatures } from "../../models/FeatureModel";
import { removeProjectFromProjectRoles } from "../../models/OrganizationModel";
import { removeProjectFromExperiments } from "../../models/ExperimentModel";
import { removeProjectFromSlackIntegration } from "../../models/SlackIntegrationModel";
import { EventAuditUserForResponseLocals } from "../../events/event-types";

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
    EventAuditUserForResponseLocals
  >
) => {
  req.checkPermissions("manageProjects", "");

  const { name, description } = req.body;
  const { org } = getOrgFromReq(req);

  const doc = await createProject(org.id, {
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
    EventAuditUserForResponseLocals
  >
) => {
  const { id } = req.params;
  req.checkPermissions("manageProjects", id);

  const { org } = getOrgFromReq(req);

  const project = await findProjectById(id, org.id);

  if (!project) {
    res.status(404).json({
      message: "Could not find project",
    });
    return;
  }

  const { name, description } = req.body;

  await updateProject(id, project.organization, {
    name,
    description,
    dateUpdated: new Date(),
  });

  res.status(200).json({
    status: 200,
  });
};

// endregion PUT /projects/:id

// region DELETE /projects/:id

type DeleteProjectRequest = AuthRequest<null, { id: string }>;

type DeleteProjectResponse = {
  status: 200;
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
    EventAuditUserForResponseLocals
  >
) => {
  const { id } = req.params;
  req.checkPermissions("manageProjects", id);

  const { org } = getOrgFromReq(req);

  await deleteProjectById(id, org.id);

  // Cleanup functions from other models
  await removeProjectFromDatasources(id, org.id);
  await removeProjectFromMetrics(id, org.id);
  await removeProjectFromFeatures(id, org, res.locals.eventAudit);
  await removeProjectFromExperiments(id, org, res.locals.eventAudit);
  await removeProjectFromProjectRoles(id, org);
  await removeProjectFromSlackIntegration({
    organizationId: org.id,
    projectId: id,
  });
  // ideas?
  // report?
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
  res: Response<PutProjectSettingsResponse | ApiErrorResponse>
) => {
  const { id } = req.params;
  req.checkPermissions("manageProjects", id);

  const { org } = getOrgFromReq(req);

  const project = await findProjectById(id, org.id);

  if (!project) {
    res.status(404).json({
      message: "Could not find project",
    });
    return;
  }

  const { settings } = req.body;

  await updateProjectSettings(id, project.organization, settings);

  res.status(200).json({
    status: 200,
    settings,
  });
};
