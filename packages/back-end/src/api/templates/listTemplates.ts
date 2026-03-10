import { ListTemplatesResponse } from "shared/types/openapi";
import { listTemplatesValidator } from "shared/validators";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listTemplates = createApiRequestHandler(listTemplatesValidator)(
  async (req): Promise<ListTemplatesResponse> => {
    const templates = await req.context.models.experimentTemplates.getAll();

    const { filtered, returnFields } = applyPagination(
      templates
        .filter((t) =>
          req.context.permissions.canReadSingleProjectResource(t.project),
        )
        .filter((t) => applyFilter(req.query.projectId, t.project))
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query,
    );

    return {
      templates: filtered.map((template) =>
        req.context.models.experimentTemplates.toApiInterface(template),
      ),
      ...returnFields,
    };
  },
);
