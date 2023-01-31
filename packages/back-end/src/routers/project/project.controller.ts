import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { ProjectInterface } from "../../../types/project";
import {
  createProject,
  deleteProjectById,
  findProjectById,
  updateProject,
} from "../../models/ProjectModel";
import { removeProjectFromDatasources } from "../../models/DataSourceModel";
import { removeProjectFromMetrics } from "../../models/MetricModel";
import { removeProjectFromFeatures } from "../../models/FeatureModel";
import { removeProjectFromExperiments } from "../../services/experiments";
import { removeProjectFromProjectRoles } from "../../models/OrganizationModel";
import { removeProjectFromSlackIntegration } from "../../models/SlackIntegrationModel";

// region POST /projects

type CreateProjectRequest = AuthRequest<{ name: string }>;

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
  res: Response<CreateProjectResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageProjects");

  const { name } = req.body;
  const { org } = getOrgFromReq(req);

  const doc = await createProject(org.id, {
    name,
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
  res: Response<PutProjectResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageProjects");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const project = await findProjectById(id, org.id);

  if (!project) {
    res.status(404).json({
      message: "Could not find project",
    });
    return;
  }

  const { name } = req.body;

  await updateProject(id, project.organization, {
    name,
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
  res: Response<DeleteProjectResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageProjects");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  await deleteProjectById(id, org.id);

  // Cleanup functions from other models
  await removeProjectFromDatasources(id, org.id);
  await removeProjectFromMetrics(id, org.id);
  await removeProjectFromFeatures(id, org);
  await removeProjectFromExperiments(id, org);
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
