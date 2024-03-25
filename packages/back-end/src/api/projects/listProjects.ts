import { listProjectsValidator } from "@back-end/src/validators/openapi";
import { ListProjectsResponse } from "@back-end/types/openapi";
import {
  findAllProjectsByOrganization,
  toProjectApiInterface,
} from "@back-end/src/models/ProjectModel";
import {
  applyPagination,
  createApiRequestHandler,
} from "@back-end/src/util/handler";

export const listProjects = createApiRequestHandler(listProjectsValidator)(
  async (req): Promise<ListProjectsResponse> => {
    const projects = await findAllProjectsByOrganization(req.context);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      projects: filtered.map((project) => toProjectApiInterface(project)),
      ...returnFields,
    };
  }
);
