import { listAttributesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listAttributes = createApiRequestHandler(listAttributesValidator)(
  async (req) => {
    const { projectId } = req.query;

    const attributes = (req.context.org.settings?.attributeSchema || []).filter(
      (attribute) => {
        if (attribute.archived) return false;
        if (
          !req.context.permissions.canReadMultiProjectResource(
            attribute.projects,
          )
        )
          return false;
        if (projectId) {
          // Keep org-wide attributes (no project restriction) and attributes
          // explicitly scoped to the requested project.
          const scoped = attribute.projects?.length;
          if (scoped && !attribute.projects?.includes(projectId)) return false;
        }
        return true;
      },
    );

    return { attributes };
  },
);
