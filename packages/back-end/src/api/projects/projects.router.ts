import { OpenApiRoute } from "back-end/src/util/handler";
import { getProject } from "./getProject";
import { listProjects } from "./listProjects";
import { putProject } from "./putProject";
import { postProject } from "./postProject";
import { deleteProject } from "./deleteProject";

export const projectsRoutes: OpenApiRoute[] = [
  listProjects,
  postProject,
  getProject,
  putProject,
  deleteProject,
];
