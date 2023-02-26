import { z } from "zod";
import { ListProjectsResponse } from "../../../types/api";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listProjects = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (req): Promise<ListProjectsResponse> => {
    const projects = await findAllProjectsByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      projects: filtered.map((project) => ({
        id: project.id,
        name: project.name,
        dateCreated: project.dateCreated.toISOString(),
        dateUpdated: project.dateUpdated.toISOString(),
      })),
      ...returnFields,
    };
  }
);
