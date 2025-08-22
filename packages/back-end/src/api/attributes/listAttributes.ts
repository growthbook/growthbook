import { ListAttributesResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { listAttributesValidator } from "back-end/src/validators/openapi";

export const listAttributes = createApiRequestHandler(listAttributesValidator)(
  async (req): Promise<ListAttributesResponse> => {
    const attributes = (req.context.org.settings?.attributeSchema || []).filter(
      (attribute) =>
        !attribute.archived &&
        req.context.permissions.canReadMultiProjectResource(attribute.projects),
    );

    return { attributes };
  },
);
