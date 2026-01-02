import { ListProjectsResponse } from "shared/types/openapi";
import { listProjectsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listProjects = createApiRequestHandler(listProjectsValidator)(
  async (req): Promise<ListProjectsResponse> => {
    const projects = await req.context.models.projects.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    return {
      projects: filtered.map((project) =>
        req.context.models.projects.toApiInterface(project),
      ),
      ...returnFields,
    };
  },
);
