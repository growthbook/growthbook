import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import {
  createProject,
  deleteProjectById,
  findProjectById,
  updateProject,
} from "../models/ProjectModel";
import { ProjectInterface } from "../../types/project";

export async function postProjects(
  req: AuthRequest<Partial<ProjectInterface>>,
  res: Response
) {
  const { name } = req.body;

  const doc = await createProject(req.organization.id, name);

  res.status(200).json({
    status: 200,
    project: doc,
  });
}
export async function putProject(
  req: AuthRequest<Partial<ProjectInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;
  const project = await findProjectById(id, req.organization.id);

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
  req: AuthRequest<Partial<ProjectInterface>>,
  res: Response
) {
  const { id }: { id: string } = req.params;

  await deleteProjectById(id, req.organization.id);

  res.status(200).json({
    status: 200,
  });
}
