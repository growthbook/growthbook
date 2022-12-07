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
import { getDataSourcesByIds } from "../../models/DataSourceModel";
import { getMetricsByIds } from "../../models/MetricModel";

// region POST /projects

type CreateProjectRequest = AuthRequest<{
  name: string;
  datasources?: string[];
  metrics?: string[];
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
  res: Response<CreateProjectResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageProjects");

  const datasources: string[] = req.body.datasources || [];
  const metrics: string[] = req.body.metrics || [];
  const { name } = req.body;
  const { org } = getOrgFromReq(req);

  const datasourceDocs = await getDataSourcesByIds(datasources, org.id);
  for (let i = 0; i < datasources.length; i++) {
    const datasource = datasourceDocs.find((dsd) => dsd.id === datasources[i]);
    if (!datasource) {
      res.status(403).json({
        message: "Invalid datasource: " + datasources[i],
      });
      return;
    }
  }

  const metricDocs = await getMetricsByIds(metrics, org.id);
  for (let i = 0; i < metrics.length; i++) {
    const metric = metricDocs.find((md) => md.id === metrics[i]);
    if (!metric) {
      res.status(403).json({
        message: "Invalid metric: " + metrics[i],
      });
      return;
    }
  }

  const doc = await createProject(org.id, {
    name,
    datasources,
    metrics,
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
  {
    id: string;
    datasources?: string[];
    metrics?: string[];
  },
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
    res.status(403).json({
      message: "Could not find project",
    });
    return;
  }

  const datasources: string[] = req.body.datasources || [];
  const metrics: string[] = req.body.metrics || [];
  const { name } = req.body;

  const datasourceDocs = await getDataSourcesByIds(datasources, org.id);
  for (let i = 0; i < datasources.length; i++) {
    const datasource = datasourceDocs.find((dsd) => dsd.id === datasources[i]);
    if (!datasource) {
      res.status(403).json({
        message: "Invalid datasource: " + datasources[i],
      });
      return;
    }
  }

  const metricDocs = await getMetricsByIds(metrics, org.id);
  for (let i = 0; i < metrics.length; i++) {
    const metric = metricDocs.find((md) => md.id === metrics[i]);
    if (!metric) {
      res.status(403).json({
        message: "Invalid metric: " + metrics[i],
      });
      return;
    }
  }

  await updateProject(id, project.organization, {
    name,
    datasources,
    metrics,
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

  res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /projects/:id
