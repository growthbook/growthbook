import { ListProjectsResponse } from "../../../types/openapi";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listProjectsValidator } from "../../validators/openapi";

export const listProjects = createApiRequestHandler(listProjectsValidator)(
  async (req): Promise<ListProjectsResponse> => {
    const projects = await req.context.models.projects.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      projects: filtered.map((project) =>
        req.context.models.projects.toApiInterface(project)
      ),
      ...returnFields,
    };
  }
);
