import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import {
  createProject,
  deleteProjectById,
  findProjectById,
  updateProject,
} from "../models/ProjectModel";
import { ProjectInterface } from "../../types/project";
import { getOrgFromReq } from "../services/organizations";

export async function postProjects(
  req: AuthRequest<Partial<ProjectInterface>>,
  res: Response
) {
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
}
export async function putProject(
  req: AuthRequest<Partial<ProjectInterface>, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageProjects");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const project = await findProjectById(id, org.id);

  if (!project) {
    throw new Error("Could not find project");
  }

  const { name } = req.body;

  await updateProject(id, project.organization, {
    name,
    dateUpdated: new Date(),
  });

  res.status(200).json({
    status: 200,
  });
}

export async function deleteProject(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  req.checkPermissions("manageProjects");

  const { id } = req.params;
  const { org } = getOrgFromReq(req);

  await deleteProjectById(id, org.id);

  res.status(200).json({
    status: 200,
  });
}
