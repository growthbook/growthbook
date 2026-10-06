import { listProjectsValidator } from "shared/validators";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listProjects = createApiRequestHandler(listProjectsValidator)(
  async (req) => {
    const projects = await req.context.models.projects.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      projects.sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    return {
      projects: await resolveOwnerEmails(
        filtered.map((project) =>
          req.context.models.projects.toApiInterface(project),
        ),
        req.context,
      ),
      ...returnFields,
    };
  },
);
